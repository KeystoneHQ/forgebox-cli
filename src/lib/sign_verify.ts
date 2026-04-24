import * as fs from 'fs';
import * as crypto from 'crypto';
import { ec as EC } from 'elliptic';
import { qlzCompress } from './quicklz';
import { CryptoManager } from './crypto';

/**
 * OTA package format.
 *
 * On-disk layout:
 *
 *   offset  size  field
 *   ------  ----  ------------------------------------------------------------
 *        0     4  headerLen (uint32 LE) — always 348
 *        4     8  mark "~fwdata!"
 *       12     4  compressedSize  (uint32 BE)
 *       16     4  originalSize    (uint32 BE)
 *       20    32  compressedHash  (SHA-256 of compressed payload)
 *       52    32  originalHash    (SHA-256 of original firmware)
 *       84     4  encode          (uint32 BE, always 1 = QuickLZ)
 *       88     4  encodeUnit      (uint32 BE, always 16384 = CHUNK_SIZE)
 *       92     4  encrypt         (uint32 BE, always 0)
 *       96   128  signature       (compressed-hash sig, ASCII hex of 64 raw bytes)
 *      224   128  originalSignature (original-hash sig, ASCII hex of 64 raw bytes)
 *      352     1  reserved 0x00
 *      353   ...  compressed payload (concatenated 16384-byte QuickLZ chunks)
 *
 * Notes / quirks:
 *  - Signatures are written as 128 ASCII hex characters, NOT 64 raw bytes.
 *    The bootloader treats the field as a C string (printf "%s", strlen,
 *    per-char IsHexChar) and hex-decodes inside verify_frimware_signature.
 *  - Two signatures share one private key: one over the compressed-payload
 *    hash (verified before flashing) and one over the decompressed-firmware
 *    hash (verified after flashing).
 *  - Unsigned placeholders use distinct fill bytes so the bootloader's
 *    IsHexChar check fails: 0x00 for `signature`, 0x1f for `originalSignature`.
 *    The 0x1f value is historical — don't change it without a bootloader update.
 *  - The format is wasteful (2x ASCII hex) but is locked in by shipped
 *    bootloader firmware. Any change requires a coordinated bootloader release.
 */

const ec = new EC('secp256k1');

const CHUNK_SIZE = 16384;
const UPDATE_MARK = '~fwdata!';

type HeaderOptions = {
  compressedSize: number;
  originalSize: number;
  compressedHash: Buffer;
  originalHash: Buffer;
  signature: Buffer | null;
  originalSignature: Buffer | null;
};

type VerifyResult = {
  mark_ok: boolean;
  compressed_hash_match: boolean;
  compressed_signature_ok: boolean | null;
  original_hash_match: boolean | null;
  original_signature_ok: boolean | null;
};

function sha256(buf: Buffer): Buffer {
  return crypto.createHash('sha256').update(buf).digest();
}

function compressChunks(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < buf.length; offset += CHUNK_SIZE) {
    const chunk = buf.slice(offset, offset + CHUNK_SIZE);
    const compressed = qlzCompress(chunk, 3);
    parts.push(compressed);
  }
  return Buffer.concat(parts);
}

function signDataWithKey(hash: Buffer, privateKeyHex: string): Buffer {
  // Delegate to the single canonical signer (RFC-6979 + Low-S + pers).
  return CryptoManager.signHash(Buffer.from(privateKeyHex, 'hex'), hash);
}

function verifySignature(hash: Buffer, signature: Buffer, publicKeyHex?: string | null): boolean {
  const keyHex = publicKeyHex || "";
  const key = ec.keyFromPublic(keyHex, 'hex');
  const r = signature.slice(0, 32).toString('hex');
  const s = signature.slice(32, 64).toString('hex');
  return key.verify(hash, { r, s });
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function buildHeader({
  compressedSize,
  originalSize,
  compressedHash,
  originalHash,
  signature,
  originalSignature,
}: HeaderOptions): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from(UPDATE_MARK));
  parts.push(u32be(compressedSize));
  parts.push(u32be(originalSize));
  parts.push(Buffer.from(compressedHash));
  parts.push(Buffer.from(originalHash));
  parts.push(u32be(1));
  parts.push(u32be(CHUNK_SIZE));
  parts.push(u32be(0));

  if (signature) {
    const sigHex = signature.toString('hex');
    const sigBytes = Buffer.from(sigHex, 'ascii');
    if (sigBytes.length !== 128) {
      throw new Error('signature hex length invalid');
    }
    parts.push(sigBytes);
  } else {
    parts.push(Buffer.alloc(128, 0x00));
  }

  if (originalSignature) {
    const sigHex = originalSignature.toString('hex');
    const sigBytes = Buffer.from(sigHex, 'ascii');
    if (sigBytes.length !== 128) {
      throw new Error('original signature hex length invalid');
    }
    parts.push(sigBytes);
  } else {
    parts.push(Buffer.alloc(128, 0x1f));
  }

  return Buffer.concat(parts);
}

function parseSignature(bytes: Buffer, placeholder: number): Buffer | null {
  let allPlaceholder = true;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== placeholder) {
      allPlaceholder = false;
      break;
    }
  }
  if (allPlaceholder) {
    return null;
  }
  const sigHex = bytes.toString('ascii');
  const sig = Buffer.from(sigHex, 'hex');
  if (sig.length !== 64) {
    throw new Error('signature length invalid');
  }
  return sig;
}

export function processOta(source: string, destination: string, privateKeyHex: string | null = null): void {
  const originalBytes = fs.readFileSync(source);
  const compressedBytes = compressChunks(originalBytes);

  const compressedHash = sha256(compressedBytes);
  const originalHash = sha256(originalBytes);

  const signature = privateKeyHex
    ? signDataWithKey(compressedHash, privateKeyHex)
    : null;
  const originalSignature = privateKeyHex
    ? signDataWithKey(originalHash, privateKeyHex)
    : null;

  const header = buildHeader({
    compressedSize: compressedBytes.length,
    originalSize: originalBytes.length,
    compressedHash,
    originalHash,
    signature,
    originalSignature,
  });

  const headLen = Buffer.alloc(4);
  headLen.writeUInt32LE(header.length);

  const out = Buffer.concat([headLen, header, Buffer.from([0x00]), compressedBytes]);
  fs.writeFileSync(destination, out);
}

export function verifyOta(path: string, originalPath: string | null = null, publicKeyHex: string | null = null): VerifyResult {
  const data = fs.readFileSync(path);
  if (data.length < 4) {
    throw new Error('header too short');
  }

  const headerLen = data.readUInt32LE(0);
  const headerStart = 4;
  const headerEnd = headerStart + headerLen;

  if (data.length < headerEnd + 1) {
    throw new Error('header length invalid');
  }

  const header = data.slice(headerStart, headerEnd);
  if (header.length < 348) {
    throw new Error('header size invalid');
  }

  let idx = 0;
  const mark = header.slice(idx, idx + 8);
  idx += 8;

  const markOk = mark.equals(Buffer.from(UPDATE_MARK));
  if (!markOk) {
    throw new Error('mark invalid');
  }

  idx += 4;
  idx += 4;

  const compressedHash = header.slice(idx, idx + 32);
  idx += 32;

  const originalHash = header.slice(idx, idx + 32);
  idx += 32;

  idx += 4;
  idx += 4;
  idx += 4;

  const signatureBytes = header.slice(idx, idx + 128);
  idx += 128;
  const originalSignatureBytes = header.slice(idx, idx + 128);

  const signature = parseSignature(signatureBytes, 0x00);
  const originalSignature = parseSignature(originalSignatureBytes, 0x1f);

  const payloadStart = headerEnd + 1;
  const compressedBytes = data.slice(payloadStart);

  const computedCompressedHash = sha256(compressedBytes);
  const compressedHashMatch = computedCompressedHash.equals(compressedHash);

  const compressedSignatureOk = signature
    ? verifySignature(compressedHash, signature, publicKeyHex)
    : null;

  const originalSignatureOk = originalSignature
    ? verifySignature(originalHash, originalSignature, publicKeyHex)
    : null;

  let originalHashMatch: boolean | null = null;
  if (originalPath) {
    const originalBytes = fs.readFileSync(originalPath);
    const computedOriginalHash = sha256(originalBytes);
    originalHashMatch = computedOriginalHash.equals(originalHash);
  }

  return {
    mark_ok: true,
    compressed_hash_match: compressedHashMatch,
    compressed_signature_ok: compressedSignatureOk,
    original_hash_match: originalHashMatch,
    original_signature_ok: originalSignatureOk,
  };
}