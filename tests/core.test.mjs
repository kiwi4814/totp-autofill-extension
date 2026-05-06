import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import { base32Encode, base32Decode } from '../src/core/base32.js';
import { generateTotp } from '../src/core/totp.js';
import { importAegisJson, importGoogleMigrationUri, normalizeEntry, parseOtpAuthUri } from '../src/core/importers.js';
import { scrypt } from '../src/core/scrypt.js';
import { findEntriesForHost, normalizeHost } from '../src/core/matcher.js';
import { addEntryDomain, updateEntry } from '../src/storage.js';
import { chooseAutofillPlan } from '../src/core/autofill-planner.js';

const textBytes = (text) => new TextEncoder().encode(text);

function encodeVarint(value) {
  const bytes = [];
  let n = BigInt(value);
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return bytes;
}

function fieldVarint(field, value) {
  return [...encodeVarint((field << 3) | 0), ...encodeVarint(value)];
}

function fieldBytes(field, valueBytes) {
  return [...encodeVarint((field << 3) | 2), ...encodeVarint(valueBytes.length), ...valueBytes];
}


function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function aesGcmEncrypt(keyBytes, plaintextBytes, nonceBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBytes, tagLength: 128 }, key, plaintextBytes));
  return {
    cipher: sealed.slice(0, -16),
    tag: sealed.slice(-16),
  };
}

async function encryptedAegisFixture(password) {
  const salt = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const masterKey = hexToBytes('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f');
  const slotNonce = hexToBytes('404142434445464748494a4b');
  const dbNonce = hexToBytes('505152535455565758595a5b');
  const derivedKey = scryptSync(password, salt, 32, { N: 1024, r: 8, p: 1 });
  const encryptedMasterKey = await aesGcmEncrypt(derivedKey, masterKey, slotNonce);
  const db = {
    entries: [{
      type: 'totp',
      name: 'encrypted@example.com',
      issuer: 'EncryptedGitHub',
      info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 },
    }],
  };
  const encryptedDb = await aesGcmEncrypt(masterKey, textBytes(JSON.stringify(db)), dbNonce);

  return JSON.stringify({
    version: 1,
    header: {
      slots: [{
        type: 1,
        uuid: '00000000-0000-4000-8000-000000000000',
        key: bytesToHex(encryptedMasterKey.cipher),
        key_params: { nonce: bytesToHex(slotNonce), tag: bytesToHex(encryptedMasterKey.tag) },
        n: 1024,
        r: 8,
        p: 1,
        salt: bytesToHex(salt),
        repaired: true,
        is_backup: true,
      }],
      params: { nonce: bytesToHex(dbNonce), tag: bytesToHex(encryptedDb.tag) },
    },
    db: bytesToBase64(encryptedDb.cipher),
  });
}

function migrationUriForOneTotp({ secretBytes, name, issuer }) {
  const otp = [
    ...fieldBytes(1, secretBytes),
    ...fieldBytes(2, textBytes(name)),
    ...fieldBytes(3, textBytes(issuer)),
    ...fieldVarint(4, 1),
    ...fieldVarint(5, 1),
    ...fieldVarint(6, 2),
  ];
  const payload = [
    ...fieldBytes(1, otp),
    ...fieldVarint(2, 1),
    ...fieldVarint(3, 1),
    ...fieldVarint(4, 0),
    ...fieldVarint(5, 1234),
  ];
  const base64 = Buffer.from(payload).toString('base64');
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}

test('base32 round-trips bytes without padding', () => {
  const bytes = textBytes('Hello!');
  const encoded = base32Encode(bytes);
  assert.equal(encoded, 'JBSWY3DPEE');
  assert.deepEqual(base32Decode(encoded), bytes);
});

test('generateTotp matches RFC 6238 SHA1 test vector', async () => {
  const code = await generateTotp({
    secret: base32Encode(textBytes('12345678901234567890')),
    algorithm: 'SHA1',
    digits: 8,
    period: 30,
    timestamp: 59_000,
  });
  assert.equal(code, '94287082');
});

test('parseOtpAuthUri extracts issuer, account, secret and options', () => {
  const entry = parseOtpAuthUri('otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60');
  assert.equal(entry.issuer, 'GitHub');
  assert.equal(entry.account, 'alice@example.com');
  assert.equal(entry.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(entry.algorithm, 'SHA256');
  assert.equal(entry.digits, 8);
  assert.equal(entry.period, 60);
});

test('importAegisJson imports plain Aegis TOTP entries', async () => {
  const aegis = JSON.stringify({
    version: 1,
    db: {
      entries: [{
        type: 'totp',
        name: 'alice@example.com',
        issuer: 'GitHub',
        info: { secret: 'jbswy3dpehpk3pxp', algo: 'SHA1', digits: 6, period: 30 },
      }, {
        type: 'hotp',
        name: 'skip@example.com',
        issuer: 'Skip',
        info: { secret: 'JBSWY3DPEHPK3PXP' },
      }],
    },
  });

  const entries = await importAegisJson(aegis);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].issuer, 'GitHub');
  assert.equal(entries[0].secret, 'JBSWY3DPEHPK3PXP');
});

test('importGoogleMigrationUri imports TOTP accounts from migration protobuf', () => {
  const uri = migrationUriForOneTotp({
    secretBytes: textBytes('Hello!'),
    name: 'alice@example.com',
    issuer: 'GitHub',
  });
  const entries = importGoogleMigrationUri(uri);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].issuer, 'GitHub');
  assert.equal(entries[0].account, 'alice@example.com');
  assert.equal(entries[0].secret, 'JBSWY3DPEE');
  assert.equal(entries[0].algorithm, 'SHA1');
  assert.equal(entries[0].digits, 6);
});


test('scrypt matches RFC 7914 test vector', async () => {
  const key = await scrypt(textBytes('password'), textBytes('NaCl'), 1024, 8, 16, 64);
  assert.equal(
    bytesToHex(key),
    'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
  );
});

test('importAegisJson decrypts password-protected Aegis exports', async () => {
  const aegis = await encryptedAegisFixture('correct horse battery staple');
  const entries = await importAegisJson(aegis, { password: 'correct horse battery staple' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].issuer, 'EncryptedGitHub');
  assert.equal(entries[0].account, 'encrypted@example.com');
  assert.equal(entries[0].secret, 'JBSWY3DPEHPK3PXP');
});

test('importAegisJson asks for a password for encrypted Aegis exports', async () => {
  const aegis = await encryptedAegisFixture('correct horse battery staple');
  await assert.rejects(
    () => importAegisJson(aegis),
    /Aegis backup password is required/,
  );
});




test('chooseAutofillPlan fills single-character OTP input groups digit by digit', () => {
  const plan = chooseAutofillPlan([
    { type: 'text', maxLength: 1, value: '', visible: true },
    { type: 'text', maxLength: 1, value: '', visible: true },
    { type: 'text', maxLength: 1, value: '', visible: true },
    { type: 'text', maxLength: 1, value: '', visible: true },
    { type: 'text', maxLength: 1, value: '', visible: true },
    { type: 'text', maxLength: 1, value: '', visible: true },
  ], '123456');

  assert.deepEqual(plan, { mode: 'split', indexes: [0, 1, 2, 3, 4, 5], values: ['1', '2', '3', '4', '5', '6'] });
});

test('chooseAutofillPlan allows password inputs only when they strongly look like OTP fields', () => {
  assert.deepEqual(chooseAutofillPlan([
    { type: 'password', autocomplete: 'current-password', name: 'password', value: '', visible: true },
    { type: 'password', autocomplete: 'one-time-code', name: 'otp', maxLength: 6, value: '', visible: true },
  ], '123456'), { mode: 'single', index: 1, value: '123456' });
});

test('normalizeEntry normalizes and deduplicates domain aliases', () => {
  const entry = normalizeEntry({
    issuer: 'GitHub',
    account: 'alice@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    domains: ['https://www.github.com/login', 'github.com', ' login.github.com '],
  });

  assert.deepEqual(entry.domains, ['github.com']);
});

test('storage can update metadata and bind the current host as a domain alias', async () => {
  const saved = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: saved.length ? saved.at(-1) : defaults.totpEntries };
        },
        async set(value) {
          saved.push(value.totpEntries);
        },
      },
    },
  };

  const original = normalizeEntry({ issuer: 'GitHub', account: 'old@example.com', secret: 'JBSWY3DPEHPK3PXP' });
  saved.push([original]);

  await updateEntry(original.id, { account: 'alice@example.com', domains: ['example.com'] });
  const updated = saved.at(-1)[0];
  assert.equal(updated.account, 'alice@example.com');
  assert.deepEqual(updated.domains, ['example.com']);

  await addEntryDomain(original.id, 'https://www.github.com/sessions/two-factor');
  assert.deepEqual(saved.at(-1)[0].domains, ['example.com', 'github.com']);

  delete globalThis.chrome;
});

test('findEntriesForHost ranks domain aliases ahead of generic text matches', () => {
  const entries = [
    { issuer: 'Google', account: 'me@gmail.com', domains: [] },
    { issuer: 'GitHub', account: 'alice@example.com', domains: ['github.com'] },
    { issuer: 'Work Git', account: 'github.company.local', domains: [] },
  ];

  assert.equal(normalizeHost('https://www.github.com/login'), 'github.com');
  const matches = findEntriesForHost(entries, 'https://github.com/sessions/two-factor');
  assert.deepEqual(matches.map((entry) => entry.issuer), ['GitHub', 'Work Git']);
});
