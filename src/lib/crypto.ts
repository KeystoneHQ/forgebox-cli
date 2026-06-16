import { generateKeyPairSync, createVerify, createHash, createPublicKey } from 'crypto';
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
   * Generate secp256k1 key pair
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
   * Save key pair to file. Private key is written 0600; directory 0700.
   * The explicit chmod guards against pre-existing files written with a wider umask.
   */
  static saveKeys(keyPair: KeyPair, outputDir: string): { pubPath: string, privPath: string } {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    }

    const pubPath = path.join(outputDir, 'pubkey.pem');
    const privPath = path.join(outputDir, 'private.pem');

    fs.writeFileSync(pubPath, keyPair.publicKey, { mode: 0o644 });
    fs.writeFileSync(privPath, keyPair.privateKey, { mode: 0o600 });
    try { fs.chmodSync(privPath, 0o600); } catch { /* best-effort on Windows */ }

    return { pubPath, privPath };
  }

  static extractRawPublicKey(publicKeyPem: string): Buffer {
    const keyObj = createPublicKey(publicKeyPem);
    const der = keyObj.export({ format: 'der', type: 'spki' });
    return der.subarray(der.length - 65);
  }

  static getDeviceDisplayPublicKey(publicKey: Buffer): Buffer {
    if (publicKey.length === 65 && publicKey[0] === 0x04) {
      return publicKey.subarray(1);
    }

    return publicKey;
  }

  static getDeviceDisplayPublicKeyHexGroups(publicKey: Buffer): string[] {
    return CryptoManager.getDeviceDisplayPublicKey(publicKey).toString('hex').toUpperCase().match(/.{1,4}/g) || [];
  }

  static formatDeviceDisplayPublicKeyHex(publicKey: Buffer): string {
    const groups = CryptoManager.getDeviceDisplayPublicKeyHexGroups(publicKey);
    const lines: string[] = [];

    for (let i = 0; i < groups.length; i += 16) {
      lines.push(groups.slice(i, i + 16).join(' '));
    }

    return lines.join('\n  ');
  }

  /**
   * Canonical signing primitive. ALL signing in this CLI must go through here
   * so that the RFC-6979 personalization (`pers`) and Low-S (`canonical`)
   * parameters can never drift between call sites.
   */
  static signHash(privateKey: Buffer, msgHash: Buffer): Buffer {
    const keyPair = ec.keyFromPrivate(privateKey);
    const sig = keyPair.sign(msgHash, { canonical: true, pers: [msgHash] });
    const r = sig.r.toArrayLike(Buffer, 'be', 32);
    const s = sig.s.toArrayLike(Buffer, 'be', 32);
    return Buffer.concat([r, s]);
  }

  /**
   * Sign data using private key (Deterministic RFC 6979)
   */
  static sign(privateKeyPem: string, data: Buffer): Buffer {
    // Extract Raw Private Key from PEM via JWK roundtrip
    const { createPrivateKey } = require('crypto');
    const key = createPrivateKey(privateKeyPem);
    const jwk = key.export({ format: 'jwk' });
    const rawPrivKey = Buffer.from(jwk.d!, 'base64url');

    const msgHash = createHash('sha256').update(data).digest();
    return CryptoManager.signHash(rawPrivKey, msgHash);
  }

  /**
   * Sign data using Raw Private Key Buffer (Deterministic RFC 6979)
   */
  static signBuffer(privateKey: Buffer, data: Buffer): Buffer {
    const msgHash = createHash('sha256').update(data).digest();
    return CryptoManager.signHash(privateKey, msgHash);
  }

  /**
   * (Utility) Verify signature - Used for testing or simulating device behavior
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
