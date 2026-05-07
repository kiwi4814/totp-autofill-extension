import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const textBytes = (text) => new TextEncoder().encode(text);

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

function fakeElement(initial = {}) {
  return {
    textContent: '',
    innerHTML: '',
    value: '',
    files: [],
    children: [],
    disabled: false,
    listeners: {},
    classList: { toggle() {} },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    ...initial,
  };
}

test('options page can retry encrypted file import after entering password', async () => {
  const encryptedJson = await encryptedAegisFixture('correct horse battery staple');
  const saved = [];

  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#search': fakeElement(),
    '#importButton': fakeElement(),
    '#fileImport': fakeElement(),
    '#qrImport': fakeElement(),
    '#clearAll': fakeElement(),
    '#importText': fakeElement(),
    '#aegisPassword': fakeElement(),
    '#importPreview': fakeElement(),
    '#confirmImport': fakeElement(),
  };

  globalThis.document = {
    querySelector(selector) {
      return elements[selector];
    },
    createElement() {
      return fakeElement({
        querySelector() {
          return fakeElement();
        },
      });
    },
  };

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
  globalThis.confirm = () => true;

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}`;
  await import(moduleUrl);

  const fileInput = elements['#fileImport'];
  fileInput.files = [{ text: async () => encryptedJson }];
  await fileInput.listeners.change({ target: fileInput });
  assert.match(elements['#status'].textContent, /需要输入密码/);

  elements['#aegisPassword'].value = 'correct horse battery staple';
  await elements['#importButton'].listeners.click();
  assert.match(elements['#status'].textContent, /已预览 1 个条目/);

  await elements['#confirmImport'].listeners.click();
  assert.match(elements['#status'].textContent, /已导入\/更新 1 个条目/);
  assert.equal(saved.at(-1)[0].issuer, 'EncryptedGitHub');

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page exposes a user-friendly security status panel', async () => {
  const html = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.html', 'utf8');

  assert.match(html, /安全状态/);
  assert.match(html, /不联网/);
  assert.match(html, /长期站点权限/);
  assert.match(html, /便利模式/);
});

test('options page previews imported text before writing to local storage', async () => {
  const saved = [];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#search': fakeElement(),
    '#importButton': fakeElement(),
    '#fileImport': fakeElement(),
    '#qrImport': fakeElement(),
    '#clearAll': fakeElement(),
    '#importText': fakeElement({ value: 'otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub' }),
    '#aegisPassword': fakeElement(),
    '#importPreview': fakeElement(),
    '#confirmImport': fakeElement(),
  };

  globalThis.document = {
    querySelector(selector) {
      return elements[selector];
    },
    createElement() {
      return fakeElement({
        querySelector() {
          return fakeElement();
        },
      });
    },
  };

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
  globalThis.confirm = () => true;

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);

  await elements['#importButton'].listeners.click();

  assert.equal(saved.length, 0);
  assert.match(elements['#status'].textContent, /已预览 1 个条目/);
  assert.match(elements['#importPreview'].textContent, /新增/);
  assert.equal(elements['#confirmImport'].disabled, false);

  await elements['#confirmImport'].listeners.click();

  assert.equal(saved.at(-1)[0].issuer, 'GitHub');
  assert.match(elements['#status'].textContent, /已导入\/更新 1 个条目/);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});
