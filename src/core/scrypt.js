function rotl(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function load32(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function store32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function salsa208(block) {
  const x = new Uint32Array(16);
  for (let index = 0; index < 16; index += 1) {
    x[index] = load32(block, index * 4);
  }
  const original = new Uint32Array(x);

  for (let round = 0; round < 8; round += 2) {
    x[4] ^= rotl((x[0] + x[12]) >>> 0, 7);
    x[8] ^= rotl((x[4] + x[0]) >>> 0, 9);
    x[12] ^= rotl((x[8] + x[4]) >>> 0, 13);
    x[0] ^= rotl((x[12] + x[8]) >>> 0, 18);

    x[9] ^= rotl((x[5] + x[1]) >>> 0, 7);
    x[13] ^= rotl((x[9] + x[5]) >>> 0, 9);
    x[1] ^= rotl((x[13] + x[9]) >>> 0, 13);
    x[5] ^= rotl((x[1] + x[13]) >>> 0, 18);

    x[14] ^= rotl((x[10] + x[6]) >>> 0, 7);
    x[2] ^= rotl((x[14] + x[10]) >>> 0, 9);
    x[6] ^= rotl((x[2] + x[14]) >>> 0, 13);
    x[10] ^= rotl((x[6] + x[2]) >>> 0, 18);

    x[3] ^= rotl((x[15] + x[11]) >>> 0, 7);
    x[7] ^= rotl((x[3] + x[15]) >>> 0, 9);
    x[11] ^= rotl((x[7] + x[3]) >>> 0, 13);
    x[15] ^= rotl((x[11] + x[7]) >>> 0, 18);

    x[1] ^= rotl((x[0] + x[3]) >>> 0, 7);
    x[2] ^= rotl((x[1] + x[0]) >>> 0, 9);
    x[3] ^= rotl((x[2] + x[1]) >>> 0, 13);
    x[0] ^= rotl((x[3] + x[2]) >>> 0, 18);

    x[6] ^= rotl((x[5] + x[4]) >>> 0, 7);
    x[7] ^= rotl((x[6] + x[5]) >>> 0, 9);
    x[4] ^= rotl((x[7] + x[6]) >>> 0, 13);
    x[5] ^= rotl((x[4] + x[7]) >>> 0, 18);

    x[11] ^= rotl((x[10] + x[9]) >>> 0, 7);
    x[8] ^= rotl((x[11] + x[10]) >>> 0, 9);
    x[9] ^= rotl((x[8] + x[11]) >>> 0, 13);
    x[10] ^= rotl((x[9] + x[8]) >>> 0, 18);

    x[12] ^= rotl((x[15] + x[14]) >>> 0, 7);
    x[13] ^= rotl((x[12] + x[15]) >>> 0, 9);
    x[14] ^= rotl((x[13] + x[12]) >>> 0, 13);
    x[15] ^= rotl((x[14] + x[13]) >>> 0, 18);
  }

  const out = new Uint8Array(64);
  for (let index = 0; index < 16; index += 1) {
    store32(out, index * 4, (x[index] + original[index]) >>> 0);
  }
  return out;
}

function blockXor(left, right, offset = 0, length = left.length) {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = left[index] ^ right[offset + index];
  }
  return out;
}

function blockMix(input, r) {
  let x = input.slice((2 * r - 1) * 64, 2 * r * 64);
  const y = new Uint8Array(input.length);

  for (let index = 0; index < 2 * r; index += 1) {
    x = salsa208(blockXor(x, input, index * 64, 64));
    y.set(x, index * 64);
  }

  const out = new Uint8Array(input.length);
  for (let index = 0; index < r; index += 1) {
    out.set(y.slice(index * 2 * 64, index * 2 * 64 + 64), index * 64);
  }
  for (let index = 0; index < r; index += 1) {
    out.set(y.slice((index * 2 + 1) * 64, (index * 2 + 2) * 64), (index + r) * 64);
  }
  return out;
}

function integerify(block, r) {
  return load32(block, (2 * r - 1) * 64);
}

function smix(block, n, r) {
  let x = new Uint8Array(block);
  const blockLength = 128 * r;
  const v = new Uint8Array(n * blockLength);

  for (let index = 0; index < n; index += 1) {
    v.set(x, index * blockLength);
    x = blockMix(x, r);
  }

  for (let index = 0; index < n; index += 1) {
    const j = integerify(x, r) & (n - 1);
    x = blockMix(blockXor(x, v, j * blockLength, blockLength), r);
  }

  return x;
}

async function pbkdf2(password, salt, iterations, length) {
  const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function scrypt(password, salt, n, r, p, dkLen) {
  if (n <= 1 || (n & (n - 1)) !== 0) {
    throw new Error('scrypt 参数 N 必须是大于 1 的 2 的幂');
  }
  if (r <= 0 || p <= 0 || dkLen <= 0) {
    throw new Error('scrypt 参数无效');
  }

  const b = await pbkdf2(password, salt, 1, p * 128 * r);
  for (let index = 0; index < p; index += 1) {
    const start = index * 128 * r;
    b.set(smix(b.slice(start, start + 128 * r), n, r), start);
  }
  return pbkdf2(password, b, 1, dkLen);
}
