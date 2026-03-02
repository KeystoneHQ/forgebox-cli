export interface IDeviceInfo {
  vendorId: number;
  productId: number;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
}

export interface IUsbDevice {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  /**
   * Register public key to device (signature required for proof of possession)
   * @param publicKey Public Key Raw Buffer (33 or 65 bytes)
   * @param signature Signature of the public key content by private key
   */
  registerPublicKey(publicKey: Buffer, signature: Buffer): Promise<boolean>;
  
  /**
   * Request device to verify signature
   * @param data Original data
   * @param signature Signature data
   * @returns Verification result
   */
  verifySignature(data: Buffer, signature: Buffer): Promise<boolean>;

  /**
   * Get detailed device status information
   */
  getStatus(): Promise<any>;
  
  getInfo(): IDeviceInfo;
}
