const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

export function base32Encode(bytes) {
  let output = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      output += ALPHABET[(buffer >>> (bitsLeft - 5)) & 31];
      bitsLeft -= 5;
    }
  }

  if (bitsLeft > 0) {
    output += ALPHABET[(buffer << (5 - bitsLeft)) & 31];
  }

  return output;
}

export function base32Decode(value) {
  const clean = String(value).toUpperCase().replace(/[=\s-]/g, '');
  if (!clean) {
    throw new Error('Base32 secret is empty');
  }

  const bytes = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of clean) {
    if (!LOOKUP.has(char)) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }
    buffer = (buffer << 5) | LOOKUP.get(char);
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 255);
      bitsLeft -= 8;
    }
  }

  return new Uint8Array(bytes);
}

export function normalizeBase32(value) {
  return base32Encode(base32Decode(value));
}
