import { generateKeyPairSync, createSign, createVerify, createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ec as EC } from 'elliptic';

const ec = new EC('secp256k1');

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export class CryptoManager {
  /**
   * 生成 secp256k1 密钥对
   */
  static generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'secp256k1',
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    return { publicKey, privateKey };
  }

  /**
   * 保存密钥对到文件
   */
  static saveKeys(keyPair: KeyPair, outputDir: string): { pubPath: string, privPath: string } {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pubPath = path.join(outputDir, 'pubkey.pem');
    const privPath = path.join(outputDir, 'private.pem');

    fs.writeFileSync(pubPath, keyPair.publicKey);
    fs.writeFileSync(privPath, keyPair.privateKey);

    return { pubPath, privPath };
  }

  /**
   * 使用私钥对数据进行签名 (Deterministic RFC 6979)
   */
  static sign(privateKeyPem: string, data: Buffer): Buffer {
    // 1. 从 PEM 中提取 Raw Private Key
    // 为了兼容性，我们使用 crypto.createPrivateKey 导出 JWK，再转为 Buffer
    const { createPrivateKey } = require('crypto');
    const key = createPrivateKey(privateKeyPem);
    const jwk = key.export({ format: 'jwk' });
    
    // jwk.d 是 base64url 编码的私钥
    const rawPrivKey = Buffer.from(jwk.d!, 'base64url');

    const keyPair = ec.keyFromPrivate(rawPrivKey);
    
    // 2. 计算哈希
    const msgHash = createHash('sha256').update(data).digest();
    
    // 3. 确定性签名 (RFC 6979) + Low S (BIP-62)
    const sig = keyPair.sign(msgHash, { canonical: true, pers: [msgHash] });
    
    const r = sig.r.toArrayLike(Buffer, 'be', 32);
    const s = sig.s.toArrayLike(Buffer, 'be', 32);
    
    return Buffer.concat([r, s]);
  }

  /**
   * 使用 Raw Private Key Buffer 对数据进行签名 (Deterministic RFC 6979)
   */
  static signBuffer(privateKey: Buffer, data: Buffer): Buffer {
    const keyPair = ec.keyFromPrivate(privateKey);
    
    // 计算哈希
    const msgHash = createHash('sha256').update(data).digest();
    
    // 确定性签名 (RFC 6979) + Low S (BIP-62)
    const sig = keyPair.sign(msgHash, { canonical: true, pers: [msgHash] });
    
    const r = sig.r.toArrayLike(Buffer, 'be', 32);
    const s = sig.s.toArrayLike(Buffer, 'be', 32);
    
    return Buffer.concat([r, s]);
  }

  /**
   * (工具方法) 验证签名 - 用于测试或模拟设备行为
   */
  static verify(publicKeyPem: string, data: Buffer, signature: Buffer): boolean {
    const verify = createVerify('SHA256');
    verify.update(data);
    verify.end();
    return verify.verify({
      key: publicKeyPem,
      dsaEncoding: 'ieee-p1363'
    }, signature);
  }
}
