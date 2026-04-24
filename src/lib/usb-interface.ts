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
   * @param publicKey Public Key Raw Buffer (65 bytes)
   * @param nonce Nonce returned by device for anti-replay flow
   * @param signature Signature of the public key content by private key
   */
  registerPublicKey(publicKey: Buffer, nonce: Buffer, signature: Buffer): Promise<boolean>;

  /**
   * Request nonce from device for anti-replay signing flow
   * @returns Nonce bytes returned by device
   */
  getNonce(): Promise<Buffer>;
  
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
