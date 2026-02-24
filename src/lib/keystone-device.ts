import { TransportNodeUSB } from '@keystonehq/hw-transport-nodeusb';
import { IUsbDevice, IDeviceInfo } from './usb-interface';
import { Actions } from '@keystonehq/hw-transport-usb';
// enum Actions {
//   CMD_GET_DEVICE_USB_PUBKEY = 6 // Ensure this matches firmware definition
// }

export class KeystoneDevice implements IUsbDevice {
  private transport: any | null = null;
  private _info: IDeviceInfo = {
    vendorId: 0,
    productId: 0,
    manufacturer: 'ForgeBox',
    product: 'Hardware Wallet',
    serialNumber: 'UNKNOWN'
  };

  async connect(): Promise<void> {
    try {
      // 自动查找并连接第一个可用的 USB 设备
      // 如果需要过滤特定 VID/PID，可能需要查看库的高级配置

      const config = {
          // endpoint: 0x01, // 默认通常是 1
          timeout: 60000, // 增加超时时间到 60秒，等待用户在设备上确认
          // maxPacketSize: 64,
          // disconnectListener: (device: any) => {
          //   console.log('Device disconnected:', device);
          // }
      }

      this.transport = await TransportNodeUSB.connect(config);
    } catch (error) {
      // 抛出错误以便上层捕获并降级到 Mock
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  async registerPublicKey(publicKey: Buffer, signature: Buffer): Promise<boolean> {
    if (!this.transport) throw new Error('Device not connected');
    // C Firmware expects:
    // 1. [1 byte] Public Key Length (33 or 65)
    // 2. [N bytes] Public Key Data
    // 3. [64 bytes] Signature

    const lenBuf = Buffer.alloc(1);
    lenBuf.writeUInt8(publicKey.length);

    const payload = Buffer.concat([
      lenBuf,
      publicKey,
      signature
      // Buffer.from(publicKey.toString('hex'), 'hex'),
      // Buffer.from(signature.toString('hex'), 'hex')
    ]);

    try {
      // CMD_GET_DEVICE_USB_PUBKEY
      const response = await this.transport.send(Actions.CMD_GET_DEVICE_USB_PUBKEY, payload);
      console.log('registerPublicKey response:', response);
      return !!response
    } catch (e: any) {
      // { data: 'verify pubkey success', status: 22 } 
      if (e.transportErrorCode === 22) {
        console.log('Public key registered successfully');
        return true;
      }
      console.error(e, "registerPublicKey failed");
      throw e;
    } finally {
      await this.transport.close();
    }
  }

  async verifySignature(data: Buffer, signature: Buffer): Promise<boolean> {
    if (!this.transport) throw new Error('Device not connected');

    // 示例：CLA=0x80, INS=0x02 (Verify)
    // 简单拼接 payload：[data_len, ...data, ...signature]
    const payload = Buffer.concat([
      Buffer.from([data.length]),
      data,
      signature
    ]);

    const response = await this.transport.send(2, payload);
    return !!response
  }

  async getStatus(): Promise<any> {
    if (!this.transport) throw new Error('Device not connected');
    
    try {
      // 尝试获取设备版本信息
      // 发送 1 字节占位符，避免空 Buffer 导致底层库报错
      const versionResp = await this.transport.send(Actions.CMD_GET_DEVICE_VERSION, Buffer.alloc(1));

      // 解析返回的对象
      let versionStr = '';
      let mfpStr = '';

      // 尝试从 Transport 对象中获取 USB 设备信息 (Model & Hardware Version & Serial)
      let modelStr = 'Hardware Wallet';
      let hwVersionStr = ''; 
      let serialStr = ''; // 优先使用 USB 描述符里的 Serial
      
      try {
        // @ts-ignore
        if (this.transport.device) {
             // @ts-ignore
             const usbDevice = this.transport.device;
             
             // Model
             if (usbDevice.productName) {
                 modelStr = usbDevice.productName;
             }
             
             // Hardware Version (从 deviceVersionMajor/Minor)
             if (usbDevice.deviceVersionMajor !== undefined) {
                 hwVersionStr = `v${usbDevice.deviceVersionMajor}.${usbDevice.deviceVersionMinor || 0}`;
             }
             // 回退：尝试从 bcdDevice 读取 (如果上面的属性不存在)
             else if (usbDevice.deviceDescriptor && usbDevice.deviceDescriptor.bcdDevice) {
                 const bcd = usbDevice.deviceDescriptor.bcdDevice;
                 const major = bcd >> 8;
                 const minor = (bcd >> 4) & 0x0F;
                 hwVersionStr = `v${major}.${minor}`;
             }
             
             // Serial Number
             if (usbDevice.serialNumber) {
                 serialStr = usbDevice.serialNumber;
             }
        }
      } catch(e) {}
      
      if (typeof versionResp === 'object' && versionResp !== null) {
        // @ts-ignore
        if (versionResp.firmwareVersion) versionStr = versionResp.firmwareVersion;
        // @ts-ignore
        if (versionResp.walletMFP) mfpStr = versionResp.walletMFP;
      }
      
      // 如果解析失败，回退到 JSON 字符串
      if (!versionStr && typeof versionResp === 'object') {
        versionStr = JSON.stringify(versionResp);
      }
      
      return {
        statusMessage: 'Connected',
        tlvArray: [
          { type: 1, value: Buffer.from(modelStr, 'utf-8') },    // Type 1 = Model
          { type: 4, value: Buffer.from(versionStr, 'utf-8') }, // Type 4 = Firmware Version
          { type: 3, value: Buffer.from(hwVersionStr, 'utf-8') },// Type 3 = Hardware Version
          { type: 2, value: Buffer.from(serialStr || mfpStr, 'utf-8') } // Type 2 = Serial Number
        ],
        rawVersion: versionStr
      };
    } catch (e) {
      console.warn('Failed to get device version:', e);
      // 降级返回基础信息
      return {
        statusMessage: 'Connected (Basic Mode)',
        tlvArray: [
          { type: 1, value: Buffer.from(this._info.product || 'Unknown', 'utf-8') },
          { type: 2, value: Buffer.from(this._info.serialNumber || 'Unknown', 'utf-8') }
        ]
      };
    }
  }

  getInfo(): IDeviceInfo {
    return this._info;
  }
}