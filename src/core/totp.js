import { base32Decode } from './base32.js';

const ALGORITHM_NAMES = new Map([
  ['SHA1', 'SHA-1'],
  ['SHA-1', 'SHA-1'],
  ['SHA256', 'SHA-256'],
  ['SHA-256', 'SHA-256'],
  ['SHA512', 'SHA-512'],
  ['SHA-512', 'SHA-512'],
]);

function getSubtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto is not available in this runtime');
  }
  return subtle;
}

function counterToBytes(counter) {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);
  return bytes;
}

export function normalizeAlgorithm(algorithm = 'SHA1') {
  const normalized = ALGORITHM_NAMES.get(String(algorithm).toUpperCase().replace(/_/g, '-'));
  if (!normalized) {
    throw new Error(`不支持的哈希函数: ${algorithm}`);
  }
  return normalized;
}

export async function generateHotp({ secret, counter, algorithm = 'SHA1', digits = 6 }) {
  const subtle = getSubtleCrypto();
  const key = await subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: normalizeAlgorithm(algorithm) },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await subtle.sign('HMAC', key, counterToBytes(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  const modulo = 10 ** digits;
  return String(binary % modulo).padStart(digits, '0');
}

export async function generateTotp({ secret, timestamp = Date.now(), period = 30, algorithm = 'SHA1', digits = 6 }) {
  const counter = Math.floor(Math.floor(timestamp / 1000) / period);
  return generateHotp({ secret, counter, algorithm, digits });
}

export function getTimeRemaining({ timestamp = Date.now(), period = 30 } = {}) {
  return period - (Math.floor(timestamp / 1000) % period);
}
