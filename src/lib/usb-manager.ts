import { IUsbDevice } from './usb-interface';
import { KeystoneDevice } from './keystone-device';
import { getDeviceList } from 'usb';
const VENDOR_ID = 0x1209; // 4617
const PRODUCT_ID = 0x3001; // 12289
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
   * List all connected USB devices
   * VID/PID filtering logic can be added here
   */
  static async listDevices(): Promise<ConnectedDeviceInfo[]> {
    const devices = getDeviceList();
    const result: ConnectedDeviceInfo[] = [];

    for (const device of devices) {
      // Filter logic: only show devices with specified VID/PID (ForgeBox)
      if (device.deviceDescriptor.idVendor !== VENDOR_ID || device.deviceDescriptor.idProduct !== PRODUCT_ID) {
        continue;
      }
      
      let manufacturer = 'Unknown';
      let product = 'Unknown';
      let serialNumber = 'Unknown';

      try {
        device.open();
        
        // Get string descriptors
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
        // Unable to open device (may be busy or insufficient permissions), can only use IDs from Descriptor
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
      // Prioritize connecting to real device
      const device = new KeystoneDevice();
      await device.connect();
      return device;
    } catch (error: any) {
      const message = error?.message || 'Failed to connect to real device.';
      return Promise.reject(message);
    }
  }
}