
import { getDeviceList, Device, Interface, InEndpoint, OutEndpoint } from 'usb';
import { IUsbDevice, IDeviceInfo } from './usb-interface';
import { 
  buildEapduPackets, 
  parseEapduResponse, 
  CmdType, 
  buildPacket,
  parseResponse,
  SERVICE_ID,
  DEVICE_INFO_CMD,
  TLV_TYPE,
  PROTOCOL,
  EapduResponse
} from './usb-protocol';

const VENDOR_ID = 0x1209;
const PRODUCT_ID = 0x3001;

export class KeystoneDevice implements IUsbDevice {
  private device: Device | null = null;
  private interface: Interface | null = null;
  private endpointIn: InEndpoint | null = null;
  private endpointOut: OutEndpoint | null = null;
  
  private _info: IDeviceInfo = {
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    manufacturer: 'ForgeBox',
    product: 'Hardware Wallet',
    serialNumber: 'UNKNOWN'
  };

  async connect(): Promise<void> {
    // Ensure any previous connection is closed
    await this.disconnect();

    try {
      const devices = getDeviceList();
      let targetDevice: Device | null = null;

      for (const device of devices) {
        if (device.deviceDescriptor.idVendor === VENDOR_ID && device.deviceDescriptor.idProduct === PRODUCT_ID) {
          targetDevice = device;
          break;
        }
      }

      if (!targetDevice) {
        throw new Error(`ForgeBox device not found (VID: 0x${VENDOR_ID.toString(16)}, PID: 0x${PRODUCT_ID.toString(16)})`);
      }

      this.device = targetDevice;
      this.device.open();

      // Initialize interface
      this.interface = this.device.interface(0);

      // Detach kernel driver (Non-Windows)
      if (process.platform !== 'win32') {
        try {
          if (this.interface.isKernelDriverActive()) {
            this.interface.detachKernelDriver();
          }
        } catch (e) {
          // Ignore detach error
        }
      }

      // Claim Interface
      try {
        this.interface.claim();
      } catch (e: any) {
        throw new Error(`Failed to claim interface: ${e.message}`);
      }

      // Find Endpoints
      const endpoints = this.interface.endpoints;
      this.endpointIn = endpoints.find(ep => ep.direction === 'in') as InEndpoint;
      this.endpointOut = endpoints.find(ep => ep.direction === 'out') as OutEndpoint;

      if (!this.endpointIn || !this.endpointOut) {
        throw new Error('Could not find required endpoints (IN/OUT)');
      }

      // Update info from descriptors
      try {
        if (this.device.deviceDescriptor.iManufacturer) {
            this.device.getStringDescriptor(this.device.deviceDescriptor.iManufacturer, (err, data) => {
                if (!err && data) this._info.manufacturer = data.toString();
            });
        }
        if (this.device.deviceDescriptor.iProduct) {
            this.device.getStringDescriptor(this.device.deviceDescriptor.iProduct, (err, data) => {
                if (!err && data) this._info.product = data.toString();
            });
        }
        if (this.device.deviceDescriptor.iSerialNumber) {
            this.device.getStringDescriptor(this.device.deviceDescriptor.iSerialNumber, (err, data) => {
                if (!err && data) this._info.serialNumber = data.toString();
            });
        }
      } catch (e) {}

      console.log(`\n✔ Device connected: ${this._info.product} (Serial: ${this._info.serialNumber || 'Unknown'})`);

    } catch (error: any) {
      if (process.platform === 'win32') {
         console.warn('\n⚠️  Windows Connection Issue detected.');
         try {
            console.log('\nPlease restart this CLI tool after installation completes.\n');
            process.exit(1); 
         } catch (e) {
            console.error('Failed to run UsbDk installer helper:', e);
         }
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.interface) {
      try {
        this.interface.release(true, (err) => {
            if (err) console.error('Release interface failed:', err);
        });
      } catch(e) {}
      this.interface = null;
    }
    if (this.device) {
      try {
        this.device.close();
      } catch(e) {}
      this.device = null;
    }
    this.endpointIn = null;
    this.endpointOut = null;
  }

  async registerPublicKey(publicKey: Buffer, signature: Buffer): Promise<boolean> {
    if (!this.device || !this.endpointOut) throw new Error('Device not connected');
    
    // Combine payload: [1 byte Length] + [Public Key] + [Signature]
    const lenBuf = Buffer.alloc(1);
    lenBuf.writeUInt8(publicKey.length);
    
    const data = Buffer.concat([lenBuf, publicKey, signature]);
    const packets = buildEapduPackets(CmdType.GET_DEVICE_USB_PUBKEY, data);
    
    console.log(`Sending ${packets.length} EAPDU packets...`);
    for (const packet of packets) {
        await this.sendRaw(packet);
        // Small delay to ensure device processes packet
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    
    // Read response
    try {
        // 1. Read immediate ACK
        const ack = await this.readEapduResponse();
        // console.log('ACK Response:', ack.statusMessage);
        // Special handling: sometimes device returns text "verify pubkey success" 
        // which causes status code parsing to fail (reads 've' as status 0x7665)
        const payloadStr = ack.payload.toString();
        const statusAsText = Buffer.alloc(2);
        statusAsText.writeUInt16BE(ack.status);
        const fullResponse = statusAsText.toString() + payloadStr;

        if (!fullResponse.includes('success')) {
            return false;
        }

        // 2. Drain any extra ACKs (if device sends ACK per packet)
        // We use a short timeout loop to consume any buffered packets
        try {
            while (true) {
                // 100ms timeout to check for buffered data
                const extraAck = await this.readEapduResponse(100);
                if (!extraAck.success) {
                    // Check if extra ACK is also a success message
                    const extraPayload = extraAck.payload.toString();
                    const extraStatusBuf = Buffer.alloc(2);
                    extraStatusBuf.writeUInt16BE(extraAck.status);
                    const extraFull = extraStatusBuf.toString() + extraPayload;
                    if (!extraFull.includes('success')) return false;
                }
            }
        } catch (e) {
            // Timeout expected when buffer is empty
            // console.log('ACK buffer drained');
        }

        // 3. Wait for user swipe confirmation (Long timeout)
        const response = await this.readEapduResponse(60000);
        
        // Parse response payload as text for debugging/logging
        const responsePayloadStr = response.payload.toString();
        const responseStatusBuf = Buffer.alloc(2);
        responseStatusBuf.writeUInt16BE(response.status);
        const fullResponseMsg = responseStatusBuf.toString() + responsePayloadStr;
        
        // console.log('\n Final Response Message:', fullResponseMsg.replace(/\0/g, '').trim()); // Clean up null bytes
        // console.log('\n Final Response Status:', response.statusMessage);
        
        // Check for success keywords in text response if status code indicates failure
        if (fullResponseMsg.includes('success')) {
            return true;
        }
        
        return false;
    } catch (e: any) {
        console.error('registerPublicKey failed:', e.message);
        return false;
    }
  }
  
  async getStatus(): Promise<any> {
      if (!this.device || !this.endpointOut) throw new Error('Device not connected');
      
      const packet = buildPacket(SERVICE_ID.DEVICE_INFO, DEVICE_INFO_CMD.BASIC, []);
      await this.sendRaw(packet);
      
      const response = await this.readProtocolResponse();
      
      // Parse TLV to object
      const result: any = {};
      if (response.tlvArray) {
          for (const tlv of response.tlvArray) {
              const val = tlv.value.toString().replace(/\0/g, '');
              if (tlv.type === TLV_TYPE.DEVICE_FIRMWARE_VERSION) {
                  result.firmwareVersion = val;
              } else if (tlv.type === TLV_TYPE.DEVICE_SERIAL_NUMBER) {
                  result.serialNumber = val;
              } else if (tlv.type === TLV_TYPE.DEVICE_MODEL) {
                  result.model = val;
              } else if (tlv.type === TLV_TYPE.DEVICE_HARDWARE_VERSION) {
                  result.hardwareVersion = val;
              }
          }
      }
      return result;
  }
  
  getInfo(): IDeviceInfo {
      return this._info;
  }

  async verifySignature(data: Buffer, signature: Buffer): Promise<boolean> {
      throw new Error("Method not implemented in new protocol.");
  }
  
  // Helpers
  
  private async sendRaw(data: Buffer): Promise<void> {
      if (!this.endpointOut) throw new Error("Endpoint not initialized");
      return new Promise((resolve, reject) => {
          this.endpointOut!.transfer(data, (err) => {
              if (err) reject(err);
              else resolve();
          });
      });
  }
  
  private async readRaw(length: number, timeout = 5000): Promise<Buffer> {
      if (!this.endpointIn) throw new Error("Endpoint not initialized");
      
      return new Promise((resolve, reject) => {
          // Set timeout
          this.endpointIn!.timeout = timeout;
          
          this.endpointIn!.transfer(length, (err, data) => {
              if (err) reject(err);
              else resolve(data as Buffer);
          });
      });
  }
  
  private async readEapduResponse(timeout = 10000): Promise<EapduResponse> {
      // Read first packet (64 bytes for EAPDU)
      const firstPacket = await this.readRaw(64, timeout);
      const firstResponse = parseEapduResponse(firstPacket);
      
      if (firstResponse.totalPackets <= 1) {
          return firstResponse;
      }
      
      const allPayloads = [firstResponse.payload];
      for (let i = 1; i < firstResponse.totalPackets; i++) {
          const packet = await this.readRaw(64, timeout);
          const response = parseEapduResponse(packet);
          allPayloads.push(response.payload);
      }
      
      const combinedPayload = Buffer.concat(allPayloads);
      firstResponse.payload = combinedPayload;
      return firstResponse;
  }
  
  private async readProtocolResponse(timeout = 5000): Promise<any> {
      // Protocol packet size can be large, read max
      const data = await this.readRaw(PROTOCOL.MAX_PACKET_SIZE, timeout);
      return parseResponse(data);
  }
}
