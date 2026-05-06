import { base32Encode, normalizeBase32 } from './base32.js';
import { base64ToBytes, concatBytes, hexToBytes } from './bytes.js';
import { scrypt } from './scrypt.js';

const DEFAULT_ENTRY = Object.freeze({
  type: 'totp',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  domains: [],
});

function nowIdPrefix() {
  return Date.now().toString(36);
}

export function stableEntryId(entry) {
  const seed = `${entry.issuer}\n${entry.account}\n${entry.secret}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `otp_${(hash >>> 0).toString(36)}`;
}

export function normalizeEntry(entry) {
  const normalized = {
    ...DEFAULT_ENTRY,
    ...entry,
    type: 'totp',
    issuer: String(entry.issuer || '').trim(),
    account: String(entry.account || entry.name || '').trim(),
    secret: normalizeBase32(entry.secret),
    algorithm: String(entry.algorithm || entry.algo || 'SHA1').toUpperCase().replace('SHA-1', 'SHA1').replace('SHA-256', 'SHA256').replace('SHA-512', 'SHA512'),
    digits: Number(entry.digits || 6),
    period: Number(entry.period || 30),
    domains: Array.isArray(entry.domains) ? entry.domains.filter(Boolean) : [],
  };
  normalized.label = normalized.issuer && normalized.account
    ? `${normalized.issuer}: ${normalized.account}`
    : normalized.issuer || normalized.account || 'Unnamed TOTP';
  normalized.id = entry.id || stableEntryId(normalized) || `otp_${nowIdPrefix()}`;
  return normalized;
}

function splitOtpLabel(pathname, issuerParam) {
  const label = decodeURIComponent(pathname.replace(/^\//, ''));
  const colon = label.indexOf(':');
  if (colon >= 0) {
    return { issuer: issuerParam || label.slice(0, colon), account: label.slice(colon + 1) };
  }
  return { issuer: issuerParam || '', account: label };
}

export function parseOtpAuthUri(uri) {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp') {
    throw new Error('Only otpauth://totp URIs are supported');
  }
  const issuerParam = parsed.searchParams.get('issuer') || '';
  const label = splitOtpLabel(parsed.pathname, issuerParam);
  const secret = parsed.searchParams.get('secret');
  if (!secret) {
    throw new Error('otpauth URI does not contain a secret');
  }
  return normalizeEntry({
    issuer: label.issuer,
    account: label.account,
    secret,
    algorithm: parsed.searchParams.get('algorithm') || 'SHA1',
    digits: Number(parsed.searchParams.get('digits') || 6),
    period: Number(parsed.searchParams.get('period') || 30),
  });
}

function entriesFromAegisData(data) {
  const entries = data.db?.entries || data.entries;
  if (!Array.isArray(entries)) {
    throw new Error('No Aegis entries found');
  }
  return entries
    .filter((entry) => String(entry.type || '').toLowerCase() === 'totp')
    .map((entry) => normalizeEntry({
      issuer: entry.issuer || '',
      account: entry.name || entry.account || '',
      secret: entry.info?.secret || entry.secret,
      algorithm: entry.info?.algo || entry.info?.algorithm || 'SHA1',
      digits: entry.info?.digits || 6,
      period: entry.info?.period || 30,
    }));
}

function isEncryptedAegisVault(data) {
  return Array.isArray(data.header?.slots) && data.header?.params && typeof data.db === 'string';
}

function passwordSlotFrom(header) {
  const slot = header.slots.find((candidate) => Number(candidate.type) === 1);
  if (!slot) {
    throw new Error('Encrypted Aegis export does not contain a password slot');
  }
  return slot;
}

async function aesGcmDecrypt(keyBytes, cipherBytes, params) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const sealed = concatBytes(cipherBytes, hexToBytes(params.tag));
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(params.nonce), tagLength: 128 },
      key,
      sealed,
    ));
  } catch (error) {
    throw new Error('Aegis decryption failed. Check the backup password.');
  }
}

async function decryptAegisVault(data, password) {
  if (!password) {
    throw new Error('Aegis backup password is required for encrypted exports');
  }
  const slot = passwordSlotFrom(data.header);
  const passwordBytes = new TextEncoder().encode(password);
  const slotKey = await scrypt(
    passwordBytes,
    hexToBytes(slot.salt),
    Number(slot.n),
    Number(slot.r),
    Number(slot.p),
    32,
  );
  const masterKey = await aesGcmDecrypt(slotKey, hexToBytes(slot.key), slot.key_params);
  const plaintext = await aesGcmDecrypt(masterKey, base64ToBytes(data.db), data.header.params);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function importAegisJson(text, { password } = {}) {
  const data = JSON.parse(text);
  if (isEncryptedAegisVault(data)) {
    return entriesFromAegisData(await decryptAegisVault(data, password));
  }
  if (data.header?.slots || data.db?.encrypted || data.encrypted) {
    throw new Error('Unsupported encrypted Aegis export format');
  }
  return entriesFromAegisData(data);
}

function readVarint(bytes, state) {
  let result = 0n;
  let shift = 0n;
  while (state.offset < bytes.length) {
    const byte = bytes[state.offset];
    state.offset += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return result;
    }
    shift += 7n;
  }
  throw new Error('Unexpected end of protobuf varint');
}

function readBytes(bytes, state) {
  const length = Number(readVarint(bytes, state));
  const end = state.offset + length;
  if (end > bytes.length) {
    throw new Error('Unexpected end of protobuf bytes field');
  }
  const value = bytes.slice(state.offset, end);
  state.offset = end;
  return value;
}

function skipField(bytes, state, wireType) {
  if (wireType === 0) {
    readVarint(bytes, state);
    return;
  }
  if (wireType === 2) {
    readBytes(bytes, state);
    return;
  }
  if (wireType === 5) {
    state.offset += 4;
    return;
  }
  if (wireType === 1) {
    state.offset += 8;
    return;
  }
  throw new Error(`Unsupported protobuf wire type: ${wireType}`);
}

function parseOtpParameters(bytes) {
  const decoder = new TextDecoder();
  const state = { offset: 0 };
  const otp = {};

  while (state.offset < bytes.length) {
    const key = Number(readVarint(bytes, state));
    const field = key >> 3;
    const wireType = key & 7;
    if (field === 1 && wireType === 2) otp.secretBytes = readBytes(bytes, state);
    else if (field === 2 && wireType === 2) otp.account = decoder.decode(readBytes(bytes, state));
    else if (field === 3 && wireType === 2) otp.issuer = decoder.decode(readBytes(bytes, state));
    else if (field === 4 && wireType === 0) otp.algorithm = Number(readVarint(bytes, state));
    else if (field === 5 && wireType === 0) otp.digits = Number(readVarint(bytes, state));
    else if (field === 6 && wireType === 0) otp.otpType = Number(readVarint(bytes, state));
    else skipField(bytes, state, wireType);
  }

  return otp;
}

function getMigrationPayloadBytes(uri) {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'otpauth-migration:') {
    throw new Error('Expected otpauth-migration:// URI');
  }
  const data = parsed.searchParams.get('data');
  if (!data) {
    throw new Error('Google Authenticator migration URI does not contain data');
  }
  return base64ToBytes(data);
}

function algorithmFromGoogle(value) {
  return ({ 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' })[value] || 'SHA1';
}

function digitsFromGoogle(value) {
  return value === 2 ? 8 : 6;
}

export function importGoogleMigrationUri(uri) {
  const bytes = getMigrationPayloadBytes(uri);
  const state = { offset: 0 };
  const entries = [];

  while (state.offset < bytes.length) {
    const key = Number(readVarint(bytes, state));
    const field = key >> 3;
    const wireType = key & 7;
    if (field === 1 && wireType === 2) {
      const otp = parseOtpParameters(readBytes(bytes, state));
      if (otp.otpType === 2 && otp.secretBytes?.length) {
        entries.push(normalizeEntry({
          issuer: otp.issuer || '',
          account: otp.account || '',
          secret: base32Encode(otp.secretBytes),
          algorithm: algorithmFromGoogle(otp.algorithm),
          digits: digitsFromGoogle(otp.digits),
          period: 30,
        }));
      }
    } else {
      skipField(bytes, state, wireType);
    }
  }

  return entries;
}

export async function importAnyText(text, options = {}) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('otpauth://')) return [parseOtpAuthUri(trimmed)];
  if (trimmed.startsWith('otpauth-migration://')) return importGoogleMigrationUri(trimmed);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return importAegisJson(trimmed, options);
  throw new Error('Unsupported import text. Paste Aegis JSON, otpauth://, or otpauth-migration:// content.');
}
