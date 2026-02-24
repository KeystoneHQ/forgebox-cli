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
   * 注册公钥到设备 (需附带签名以证明持有权)
   * @param publicKey 公钥 Raw Buffer (33 or 65 bytes)
   * @param signature 私钥对公钥内容的签名
   */
  registerPublicKey(publicKey: Buffer, signature: Buffer): Promise<boolean>;
  
  /**
   * 让设备验证签名
   * @param data 原始数据
   * @param signature 签名数据
   * @returns 验证结果
   */
  verifySignature(data: Buffer, signature: Buffer): Promise<boolean>;

  /**
   * 获取设备详细状态信息
   */
  getStatus(): Promise<any>;
  
  getInfo(): IDeviceInfo;
}
