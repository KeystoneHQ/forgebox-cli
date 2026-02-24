const HASH_VALUES = 4096;
const MINOFFSET = 2;
const UNCONDITIONAL_MATCHLEN = 6;
const UNCOMPRESSED_END = 4;
const CWORD_LEN = 4;
const QLZ_POINTERS = 16;

type CompressState = {
  hashOffsets: Int32Array;
  hashCounter: Uint8Array;
};

function fastRead(src: Uint8Array, index: number, bytes: number): number {
  if (bytes === 4) {
    const b0 = src[index] ?? 0;
    const b1 = src[index + 1] ?? 0;
    const b2 = src[index + 2] ?? 0;
    const b3 = src[index + 3] ?? 0;
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }
  if (bytes === 3) {
    const b0 = src[index] ?? 0;
    const b1 = src[index + 1] ?? 0;
    const b2 = src[index + 2] ?? 0;
    return (b0 | (b1 << 8) | (b2 << 16)) >>> 0;
  }
  if (bytes === 2) {
    const b0 = src[index] ?? 0;
    const b1 = src[index + 1] ?? 0;
    return (b0 | (b1 << 8)) >>> 0;
  }
  return (src[index] ?? 0) >>> 0;
}

function fastWrite(dst: Uint8Array, index: number, value: number, bytes: number): void {
  if (bytes >= 1) dst[index] = value & 0xff;
  if (bytes >= 2) dst[index + 1] = (value >>> 8) & 0xff;
  if (bytes >= 3) dst[index + 2] = (value >>> 16) & 0xff;
  if (bytes >= 4) dst[index + 3] = (value >>> 24) & 0xff;
}

function hashFunc(i: number): number {
  return (((i >>> 12) ^ i) & (HASH_VALUES - 1)) >>> 0;
}

function hashAt(src: Uint8Array, index: number): number {
  const fetch = fastRead(src, index, 3);
  return hashFunc(fetch);
}

function resetState(state: CompressState): void {
  state.hashCounter.fill(0);
}

function compressCore(source: Uint8Array, destination: Uint8Array, destStart: number, state: CompressState): number {
  const size = source.length;
  const lastByte = size - 1;
  const lastMatchstart = lastByte - UNCONDITIONAL_MATCHLEN - UNCOMPRESSED_END;
  let src = 0;
  let dst = destStart + CWORD_LEN;
  let cwordPtr = destStart;
  let cwordVal = 1 << 31;
  let fetch = 0;
  let lits = 0;

  if (src <= lastMatchstart) {
    fetch = fastRead(source, src, 3);
  }

  while (src <= lastMatchstart) {
    if ((cwordVal & 1) === 1) {
      if (src > (size - (size >> 2)) && dst > src - (src >> 5)) {
        return 0;
      }
      fastWrite(destination, cwordPtr, (cwordVal >>> 1) | (1 << 31), CWORD_LEN);
      cwordPtr = dst;
      dst += CWORD_LEN;
      cwordVal = 1 << 31;
      fetch = fastRead(source, src, 3);
    }

    const remaining = (lastByte - UNCOMPRESSED_END - src + 1) > 255 ? 255 : (lastByte - UNCOMPRESSED_END - src + 1);
    fetch = fastRead(source, src, 3);
    let hash = hashFunc(fetch);
    let c = state.hashCounter[hash];
    let offset2 = state.hashOffsets[(hash * QLZ_POINTERS) + 0];
    let matchlen: number;

    if (offset2 < src - MINOFFSET && c > 0 && (((fastRead(source, offset2, 3) ^ fetch) & 0xffffff) === 0)) {
      matchlen = 3;
      if (source[offset2 + matchlen] === source[src + matchlen]) {
        matchlen = 4;
        while (source[offset2 + matchlen] === source[src + matchlen] && matchlen < remaining) {
          matchlen += 1;
        }
      }
    } else {
      matchlen = 0;
    }

    for (let k = 1; k < QLZ_POINTERS && c > k; k += 1) {
      const o = state.hashOffsets[(hash * QLZ_POINTERS) + k];
      if ((((fastRead(source, o, 3) ^ fetch) & 0xffffff) === 0) && o < src - MINOFFSET) {
        let m = 3;
        while (source[o + m] === source[src + m] && m < remaining) {
          m += 1;
        }
        if (m > matchlen || (m === matchlen && o > offset2)) {
          offset2 = o;
          matchlen = m;
        }
      }
    }

    const o = offset2;
    state.hashOffsets[(hash * QLZ_POINTERS) + (c & (QLZ_POINTERS - 1))] = src;
    state.hashCounter[hash] = (c + 1) & 0xff;

    if (matchlen > 2 && (src - o) < 131071) {
      const offset = src - o;
      for (let u = 1; u < matchlen; u += 1) {
        hash = hashAt(source, src + u);
        const c2 = state.hashCounter[hash];
        state.hashOffsets[(hash * QLZ_POINTERS) + (c2 & (QLZ_POINTERS - 1))] = src + u;
        state.hashCounter[hash] = (c2 + 1) & 0xff;
      }

      cwordVal = (cwordVal >>> 1) | (1 << 31);
      src += matchlen;

      if (matchlen === 3 && offset <= 63) {
        destination[dst] = (offset << 2) & 0xff;
        dst += 1;
      } else if (matchlen === 3 && offset <= 16383) {
        const f = (offset << 2) | 1;
        fastWrite(destination, dst, f, 2);
        dst += 2;
      } else if (matchlen <= 18 && offset <= 1023) {
        const f = ((matchlen - 3) << 2) | (offset << 6) | 2;
        fastWrite(destination, dst, f, 2);
        dst += 2;
      } else if (matchlen <= 33) {
        const f = ((matchlen - 2) << 2) | (offset << 7) | 3;
        fastWrite(destination, dst, f, 3);
        dst += 3;
      } else {
        const f = ((matchlen - 3) << 7) | (offset << 15) | 3;
        fastWrite(destination, dst, f, 4);
        dst += 4;
      }
    } else {
      destination[dst] = source[src];
      src += 1;
      dst += 1;
      cwordVal = cwordVal >>> 1;
      lits += 1;
    }
  }

  while (src <= lastByte) {
    if ((cwordVal & 1) === 1) {
      fastWrite(destination, cwordPtr, (cwordVal >>> 1) | (1 << 31), CWORD_LEN);
      cwordPtr = dst;
      dst += CWORD_LEN;
      cwordVal = 1 << 31;
    }
    destination[dst] = source[src];
    src += 1;
    dst += 1;
    cwordVal = cwordVal >>> 1;
  }

  while ((cwordVal & 1) !== 1) {
    cwordVal = cwordVal >>> 1;
  }

  fastWrite(destination, cwordPtr, (cwordVal >>> 1) | (1 << 31), CWORD_LEN);

  const len = dst - destStart;
  return len < 9 ? 9 : len;
}

export function qlzCompress(input: Buffer, level = 3): Buffer {
  if (level !== 3) {
    throw new Error('Only QuickLZ level 3 is supported');
  }

  const source = new Uint8Array(input);
  const size = source.length;
  if (size === 0) {
    return Buffer.alloc(0);
  }

  const base = size < 216 ? 3 : 9;
  const destination = new Uint8Array(size + 400 + base);
  const state: CompressState = {
    hashOffsets: new Int32Array(HASH_VALUES * QLZ_POINTERS),
    hashCounter: new Uint8Array(HASH_VALUES),
  };
  resetState(state);

  const coreLen = compressCore(source, destination, base, state);
  let r: number;
  let compressed = 1;

  if (coreLen === 0) {
    destination.set(source, base);
    r = size + base;
    compressed = 0;
  } else {
    r = base + coreLen;
  }

  if (base === 3) {
    destination[0] = compressed & 0xff;
    destination[1] = r & 0xff;
    destination[2] = size & 0xff;
  } else {
    destination[0] = (2 | compressed) & 0xff;
    fastWrite(destination, 1, r, 4);
    fastWrite(destination, 5, size, 4);
  }

  destination[0] |= (level << 2);
  destination[0] |= (1 << 6);
  destination[0] |= (0 << 4);

  return Buffer.from(destination.slice(0, r));
}
