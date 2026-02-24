import { IUsbDevice } from './usb-interface';
import { KeystoneDevice } from './keystone-device';
import { getDeviceList } from 'usb';

export interface ConnectedDeviceInfo {
  vendorId: number;
  productId: number;
  manufacturer: string;
  product: string;
  serialNumber?: string;
  path?: string; // USB path if available
}

export class UsbManager {
  /**
   * 列出所有连接的 USB 设备
   * 可以在这里添加 VID/PID 过滤逻辑
   */
  static async listDevices(): Promise<ConnectedDeviceInfo[]> {
    const devices = getDeviceList();
    const result: ConnectedDeviceInfo[] = [];

    for (const device of devices) {
      // 过滤逻辑：只显示指定 VID/PID 的设备 (ForgeBox)
      if (device.deviceDescriptor.idVendor !== 0x1209 || device.deviceDescriptor.idProduct !== 0x3001) {
        continue;
      }
      
      let manufacturer = 'Unknown';
      let product = 'Unknown';
      let serialNumber = 'Unknown';

      try {
        device.open();
        
        // 获取字符串描述符
        try {
          if (device.deviceDescriptor.iManufacturer) {
            manufacturer = await new Promise<string>((resolve, reject) => {
              device.getStringDescriptor(device.deviceDescriptor.iManufacturer, (err, data) => {
                if (err) reject(err); else resolve(data?.toString() || 'Unknown');
              });
            });
          }
        } catch(e) {}

        try {
          if (device.deviceDescriptor.iProduct) {
            product = await new Promise<string>((resolve, reject) => {
              device.getStringDescriptor(device.deviceDescriptor.iProduct, (err, data) => {
                if (err) reject(err); else resolve(data?.toString() || 'Unknown');
              });
            });
          }
        } catch(e) {}
        
        try {
            if (device.deviceDescriptor.iSerialNumber) {
              serialNumber = await new Promise<string>((resolve, reject) => {
                device.getStringDescriptor(device.deviceDescriptor.iSerialNumber, (err, data) => {
                  if (err) reject(err); else resolve(data?.toString() || 'Unknown');
                });
              });
            }
        } catch(e) {}

        device.close();
      } catch (error) {
        // 无法打开设备（可能被占用或权限不足），只能使用 Descriptor 中的 ID
      }
      
      result.push({
        vendorId: device.deviceDescriptor.idVendor,
        productId: device.deviceDescriptor.idProduct,
        manufacturer,
        product,
        serialNumber
      });
    }

    return result;
  }

  static async findDevice(): Promise<IUsbDevice> {
    try {
      // 优先尝试连接真实设备
      const device = new KeystoneDevice();
      await device.connect();
      return device;
    } catch (error: any) {
      const message = error?.message || 'Failed to connect to real device.';
      return Promise.reject(message);
    }
  }
}