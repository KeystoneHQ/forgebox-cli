
import { TransportNodeUSB } from '@keystonehq/hw-transport-nodeusb';
import { Actions, encode, generateRequestID } from '@keystonehq/hw-transport-usb';
import { getDeviceList, WebUSBDevice } from 'usb';
import { IUsbDevice, IDeviceInfo } from './usb-interface';
import { 
  buildPacket,
  parseResponse,
  SERVICE_ID,
  DEVICE_INFO_CMD,
  TLV_TYPE,
  PROTOCOL,
} from './usb-protocol';
import chalk from 'chalk';

const VENDOR_ID = 0x1209;
const PRODUCT_ID = 0x3001;

enum PubkeyRegisterStatus {
  OK = 0,
  INVALID_PARAMS = 20,
  VERIFY_FAILED = 21,
  VERIFY_SUCCESS = 22,
  SET_SUCCESS = 23,
  SET_FAILED = 24,
  HAS_SET = 25,
  GET_NONCE_PARAMS_INVALID = 30,
  GET_NONCE_PARAMS_SUCCESS = 31,
  GET_NONCE_PARAMS_FAILED = 32,
}

export class KeystoneDevice implements IUsbDevice {
  private transport: TransportNodeUSB | null = null;
  private endpointIn: number | null = null;
  private endpointOut: number | null = null;
  
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
      let targetDevice: any = null;

      for (const device of devices) {
        if (device.deviceDescriptor.idVendor === VENDOR_ID && device.deviceDescriptor.idProduct === PRODUCT_ID) {
          targetDevice = device;
          break;
        }
      }

      if (!targetDevice) {
        throw new Error(`ForgeBox device not found (VID: 0x${VENDOR_ID.toString(16)}, PID: 0x${PRODUCT_ID.toString(16)})`);
      }

      // Create WebUSBDevice instance (auto-detach kernel driver on non-Windows)
      const webDevice = await WebUSBDevice.createInstance(targetDevice);
      
      this.transport = new TransportNodeUSB(webDevice as any);
      await this.transport.open();

      // Find endpoints from configuration
      // Note: TransportNodeUSB opens device and selects configuration/interface
      if (!webDevice.configuration?.interfaces[0]?.alternates[0]) {
          throw new Error('Failed to access device interface');
      }

      const endpoints = webDevice.configuration.interfaces[0].alternates[0].endpoints;
      const inEp = endpoints.find(ep => ep.direction === 'in');
      const outEp = endpoints.find(ep => ep.direction === 'out');

      if (!inEp || !outEp) {
        throw new Error('Could not find required endpoints (IN/OUT)');
      }
      
      this.endpointIn = inEp.endpointNumber;
      this.endpointOut = outEp.endpointNumber;

      // Update info from descriptors
      try {
        if (webDevice.manufacturerName) this._info.manufacturer = webDevice.manufacturerName;
        if (webDevice.productName) this._info.product = webDevice.productName;
        if (webDevice.serialNumber) this._info.serialNumber = webDevice.serialNumber;
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
    if (this.transport) {
      try {
        await this.transport.close();
      } catch(e) {}
      this.transport = null;
    }
    this.endpointIn = null;
    this.endpointOut = null;
  }

  async registerPublicKey(publicKey: Buffer, signature: Buffer): Promise<boolean> {
    if (!this.transport || this.endpointOut === null) throw new Error('Device not connected');

    // Combine payload: [1 byte Length] + [Public Key] + [Signature]
    const lenBuf = Buffer.alloc(1);
    lenBuf.writeUInt8(publicKey.length);
    const data = Buffer.concat([lenBuf, publicKey, signature]);
    
    const requestId = generateRequestID();
    const packets = encode(Actions.CMD_GET_DEVICE_USB_PUBKEY, requestId, data);
    
    console.log(`Sending ${packets.length} EAPDU packets...`);
    
    const device = (this.transport as any).device as WebUSBDevice;
    const endpointOut = (this.transport as any).endpoint;

    for (const packet of packets) {
        const buffer = Uint8Array.from(packet).buffer;
        const res = await device.transferOut(endpointOut, buffer);
        if (res.status !== 'ok') throw new Error('Transfer failed');
        // Small delay to ensure device processes packet
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    
    // Read response
    try {
        // 1. Read immediate ACK
        const ackStatus = await this.receivePubkeyRegisterStatus(requestId);
        if (!this.isPubkeyRegisterSuccessStatus(ackStatus)) {
            this.logPubkeyRegisterFailure('ACK', ackStatus);
            return false;
        }

        // 2. Drain any extra ACKs (if device sends ACK per packet)
        // TransportNodeUSB.receive reads a full response. 
        // If there are multiple responses, we might need to read again.
        // However, standard TransportNodeUSB usage implies one response.
        // We'll skip explicit draining unless we observe issues, 
        // as receive() consumes a full logical packet.

        // 3. Wait for user swipe confirmation (Long timeout)
        const originalTimeout = (this.transport as any).requestTimeout;
        (this.transport as any).requestTimeout = 60000;

        try {
            const confirmStatus = await this.receivePubkeyRegisterStatus(requestId);
            if (!this.isPubkeyRegisterSuccessStatus(confirmStatus)) {
                this.logPubkeyRegisterFailure('CONFIRM', confirmStatus);
                return false;
            }
            return true;
        } finally {
            (this.transport as any).requestTimeout = originalTimeout;
        }
    } catch (e: any) {
        console.error('registerPublicKey error:', e.message);
        return false;
    }
  }
  
  async getStatus(): Promise<any> {
      if (!this.transport || this.endpointOut === null) throw new Error('Device not connected');
      
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
      if (this.endpointOut === null || !this.transport) throw new Error("Endpoint not initialized");
      
      // Access underlying device from transport (using any to bypass private check)
      const device = (this.transport as any).device as WebUSBDevice;
      
      // WebUSB transferOut takes ArrayBuffer
       const buffer = Uint8Array.from(data).buffer;
       const result = await device.transferOut(this.endpointOut, buffer);
       
       if (result.status !== 'ok') {
          throw new Error(`USB Transfer failed with status: ${result.status}`);
      }
  }
  
  private async readRaw(length: number, timeout = 5000): Promise<Buffer> {
      if (this.endpointIn === null || !this.transport) throw new Error("Endpoint not initialized");
      
      const device = (this.transport as any).device as WebUSBDevice;
      
      // Note: WebUSB transferIn doesn't support timeout directly in the API signature?
      // Actually, standard WebUSB doesn't, but node-usb implementation might?
      // No, WebUSB API relies on Promise.race for timeout usually.
      
      const transferPromise = device.transferIn(this.endpointIn, length);
      
      // Implement timeout
      const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Transfer timeout')), timeout)
      );
      
      const result = await Promise.race([transferPromise, timeoutPromise]);
      
      if (result.status !== 'ok') {
          // If stall, we might need to clear halt?
          // For now, throw error.
           throw new Error(`USB Read failed with status: ${result.status}`);
      }
      
      if (!result.data) {
          return Buffer.alloc(0);
      }
      
      // Convert DataView to Buffer
      return Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
  }
  
  private async readProtocolResponse(timeout = 5000): Promise<any> {
      // Protocol packet size can be large, read max
      const data = await this.readRaw(PROTOCOL.MAX_PACKET_SIZE, timeout);
      return parseResponse(data);
  }

  private async receivePubkeyRegisterStatus(requestId: number): Promise<PubkeyRegisterStatus> {
      try {
          await (this.transport as any).receive(Actions.CMD_GET_DEVICE_USB_PUBKEY, requestId);
          return PubkeyRegisterStatus.OK;
      } catch (e: any) {
          const code = e?.transportErrorCode;
          if (typeof code === 'number') {
              return code as PubkeyRegisterStatus;
          }
          throw e;
      }
  }

  private isPubkeyRegisterSuccessStatus(status: PubkeyRegisterStatus): boolean {
      return status === PubkeyRegisterStatus.OK ||
        status === PubkeyRegisterStatus.VERIFY_SUCCESS ||
        status === PubkeyRegisterStatus.SET_SUCCESS ||
        status === PubkeyRegisterStatus.GET_NONCE_PARAMS_SUCCESS;
  }

  private getPubkeyRegisterStatusName(status: PubkeyRegisterStatus): string {
      const map: Record<number, string> = {
          [PubkeyRegisterStatus.OK]: 'OK',
          [PubkeyRegisterStatus.INVALID_PARAMS]: 'PRS_SET_PUBKEY_INVALID_PARAMS',
          [PubkeyRegisterStatus.VERIFY_FAILED]: 'PRS_SET_PUBKEY_VERIFY_FAILED',
          [PubkeyRegisterStatus.VERIFY_SUCCESS]: 'PRS_SET_PUBKEY_VERIFY_SUCCESS',
          [PubkeyRegisterStatus.SET_SUCCESS]: 'PRS_SET_PUBKEY_SET_SUCCESS',
          [PubkeyRegisterStatus.SET_FAILED]: 'PRS_SET_PUBKEY_SET_FAILED',
          [PubkeyRegisterStatus.HAS_SET]: 'PRS_SET_PUBKEY_HAS_SET',
          [PubkeyRegisterStatus.GET_NONCE_PARAMS_INVALID]: 'PRS_GET_NONCE_PARAMS_INVALID',
          [PubkeyRegisterStatus.GET_NONCE_PARAMS_SUCCESS]: 'PRS_GET_NONCE_PARAMS_SUCCESS',
          [PubkeyRegisterStatus.GET_NONCE_PARAMS_FAILED]: 'PRS_GET_NONCE_PARAMS_FAILED',
      };
      return map[status] ?? `UNKNOWN_STATUS_${status}`;
  }

  private getPubkeyRegisterStatusMessage(status: PubkeyRegisterStatus): string {
      const map: Record<number, string> = {
          [PubkeyRegisterStatus.INVALID_PARAMS]: 'Invalid payload: public key/signature length or format is incorrect.',
          [PubkeyRegisterStatus.VERIFY_FAILED]: 'Signature verification failed on device.',
          [PubkeyRegisterStatus.SET_FAILED]: 'Device failed to persist public key to secure storage.',
          [PubkeyRegisterStatus.HAS_SET]: 'The device already has a registered public key.',
          [PubkeyRegisterStatus.GET_NONCE_PARAMS_INVALID]: 'Invalid params while requesting nonce from device.',
          [PubkeyRegisterStatus.GET_NONCE_PARAMS_FAILED]: 'Device failed to provide nonce parameters.',
      };
      return map[status] ?? 'Device rejected request.';
  }

  private logPubkeyRegisterFailure(stage: 'ACK' | 'CONFIRM', status: PubkeyRegisterStatus): void {
      const name = this.getPubkeyRegisterStatusName(status);
      const msg = this.getPubkeyRegisterStatusMessage(status);
      console.log(chalk.red(` \n Failed at ${stage}: ${msg} (${name})`));
  }
}
