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
  const element = {
    textContent: '',
    _innerHTML: '',
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
    querySelector(selector) {
      const matches = (candidate) => {
        if (selector.startsWith('#')) return candidate.id === selector.slice(1);
        if (selector.startsWith('.')) return String(candidate.className || '').split(/\s+/).includes(selector.slice(1));
        return String(candidate.tagName || '').toLowerCase() === selector.toLowerCase();
      };
      const queue = [...this.children];
      while (queue.length) {
        const node = queue.shift();
        if (matches(node)) return node;
        queue.push(...(node.children || []));
      }
      return null;
    },
    ...initial,
  };

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = value;
      this.children = [];
      for (const match of String(value).matchAll(/class="([^"]+)"/g)) {
        const beforeClass = String(value).slice(0, match.index);
        const tagMatch = beforeClass.match(/<([a-z0-9-]+)[^<]*$/i);
        this.children.push(fakeElement({
          tagName: (tagMatch?.[1] || 'div').toUpperCase(),
          className: match[1],
        }));
      }
    },
  });

  return element;
}

test('options page can retry encrypted file import after entering password', async () => {
  const encryptedJson = await encryptedAegisFixture('correct horse battery staple');
  const saved = [];

  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
  assert.match(elements['#status'].textContent, /已完成 1 个条目的导入预览/);

  await elements['#confirmImport'].listeners.click();
  assert.match(elements['#status'].textContent, /已导入并更新 1 个条目/);
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
  assert.match(html, /id="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="status"[^>]*role="status"/);
});

test('options page provides separate entry list and detail panel regions', async () => {
  const html = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.html', 'utf8');

  assert.match(html, /entry-workspace/);
  assert.match(html, /id="entries"/);
  assert.match(html, /id="entryDetail"/);
});

test('options page reserves a dedicated danger actions area', async () => {
  const html = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.html', 'utf8');

  assert.match(html, /danger-actions/);
  assert.match(html, /危险操作/);
  assert.doesNotMatch(html, /<button id="clearAll" class="danger">清空全部<\/button>/);
});

test('options page uses accessible minimum touch target sizes', async () => {
  const css = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/styles.css', 'utf8');

  assert.match(css, /button, \.button-like \{[\s\S]*min-height: 44px;/);
  assert.match(css, /textarea, input\[type="search"\], input\[type="text"\], input\[type="password"\] \{[\s\S]*min-height: 44px;/);
});

test('options page exposes clear keyboard focus states', async () => {
  const css = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/styles.css', 'utf8');

  assert.match(css, /button:focus-visible, \.button-like:focus-visible, textarea:focus-visible, input\[type="search"\]:focus-visible, input\[type="text"\]:focus-visible, input\[type="password"\]:focus-visible \{/);
  assert.match(css, /button:focus-visible, \.button-like:focus-visible, textarea:focus-visible, input\[type="search"\]:focus-visible, input\[type="text"\]:focus-visible, input\[type="password"\]:focus-visible \{[\s\S]*outline:/);
  assert.match(css, /button:focus-visible, \.button-like:focus-visible, textarea:focus-visible, input\[type="search"\]:focus-visible, input\[type="text"\]:focus-visible, input\[type="password"\]:focus-visible \{[\s\S]*outline-offset:/);
});

test('options page previews imported text before writing to local storage', async () => {
  const saved = [];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
  assert.match(elements['#status'].textContent, /已完成 1 个条目的导入预览/);
  assert.match(elements['#importPreview'].textContent, /新增 1 个/);
  assert.match(elements['#importPreview'].textContent, /新增：GitHub/);
  assert.equal(elements['#confirmImport'].disabled, false);

  await elements['#confirmImport'].listeners.click();

  assert.equal(saved.at(-1)[0].issuer, 'GitHub');
  assert.match(elements['#status'].textContent, /已导入并更新 1 个条目/);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page previews overwriting an existing entry separately from new imports', async () => {
  const saved = [[{
    issuer: 'GitHub',
    account: 'alice@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    domains: ['github.com'],
    note: 'work',
  }]];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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

  assert.match(elements['#status'].textContent, /已完成 1 个条目的导入预览/);
  assert.match(elements['#importPreview'].textContent, /将覆盖 1 个/);
  assert.match(elements['#importPreview'].textContent, /将覆盖：GitHub/);
  assert.doesNotMatch(elements['#importPreview'].textContent, /重复 1 个/);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page previews exact duplicate imports separately from overwrites', async () => {
  const saved = [[{
    issuer: 'GitHub',
    account: 'alice@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    domains: [],
    note: '',
    groups: [],
  }]];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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

  assert.match(elements['#status'].textContent, /已完成 1 个条目的导入预览/);
  assert.match(elements['#importPreview'].textContent, /重复 1 个/);
  assert.match(elements['#importPreview'].textContent, /重复：GitHub/);
  assert.doesNotMatch(elements['#importPreview'].textContent, /将覆盖 1 个/);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page saves edited entry details with a unified success message', async () => {
  const entries = [
    {
      id: 'otp_1',
      issuer: 'GitHub',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      domains: ['github.com'],
      note: '',
      label: 'GitHub: alice@example.com',
    },
  ];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() });
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: entries.length ? entries : defaults.totpEntries };
        },
        async set(value) {
          const nextEntries = value.totpEntries ?? [];
          entries.splice(0, entries.length, ...nextEntries);
        },
      },
    },
  };
  globalThis.confirm = () => true;

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);
  await new Promise((resolve) => setImmediate(resolve));

  const detail = elements['#entryDetail'];
  detail.querySelector('.edit-issuer').value = 'GitHub Team';
  await detail.querySelector('.save').listeners.click();

  assert.match(elements['#status'].textContent, /已保存条目：GitHub Team/);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page renders entry summaries separately from the selected entry editor', async () => {
  const entries = [
    {
      id: 'otp_1',
      issuer: 'GitHub',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      domains: ['github.com'],
      label: 'GitHub: alice@example.com',
    },
    {
      id: 'otp_2',
      issuer: 'Cloudflare',
      account: 'ops@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      domains: ['cloudflare.com'],
      label: 'Cloudflare: ops@example.com',
    },
  ];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() });
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: entries.length ? entries : defaults.totpEntries };
        },
        async set() {},
      },
    },
  };
  globalThis.confirm = () => true;

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements['#entries'].children.filter((child) => String(child.className).includes('entry-list-item')).length, 2);
  assert.equal(elements['#entryDetail'].children.filter((child) => String(child.className).includes('entry-editor')).length, 1);
  assert.equal(elements['#entryDetail'].querySelector('.edit-issuer').value, 'GitHub');
  assert.equal(elements['#dangerActions'].children.filter((child) => String(child.className).includes('danger-actions-card')).length, 1);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page confirms deleting the selected entry with explicit impact copy', async () => {
  const entries = [
    {
      id: 'otp_1',
      issuer: 'GitHub',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      domains: ['github.com'],
      label: 'GitHub: alice@example.com',
    },
  ];
  const confirms = [];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() });
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: entries.length ? entries : defaults.totpEntries };
        },
        async set(value) {
          const nextEntries = value.totpEntries ?? [];
          entries.splice(0, entries.length, ...nextEntries);
        },
      },
    },
  };
  globalThis.confirm = (message) => {
    confirms.push(message);
    return false;
  };

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);
  await new Promise((resolve) => setImmediate(resolve));

  const deleteButton = elements['#dangerActions'].querySelector('.danger-delete-entry');
  await deleteButton.listeners.click();

  assert.equal(confirms[0], '确认删除当前条目“GitHub: alice@example.com”？这会移除它的备注和匹配域名。');

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page reports deleting the selected entry with a unified success message', async () => {
  const entries = [
    {
      id: 'otp_1',
      issuer: 'GitHub',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      domains: ['github.com'],
      label: 'GitHub: alice@example.com',
    },
  ];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() });
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: entries.length ? entries : defaults.totpEntries };
        },
        async set(value) {
          const nextEntries = value.totpEntries ?? [];
          entries.splice(0, entries.length, ...nextEntries);
        },
      },
    },
  };
  globalThis.confirm = () => true;

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);
  await new Promise((resolve) => setImmediate(resolve));

  const deleteButton = elements['#dangerActions'].querySelector('.danger-delete-entry');
  await deleteButton.listeners.click();

  assert.match(elements['#status'].textContent, /已删除条目：GitHub: alice@example.com/);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page confirms clearing all entries with explicit impact copy', async () => {
  const entries = [
    {
      id: 'otp_1',
      issuer: 'GitHub',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      domains: ['github.com'],
      label: 'GitHub: alice@example.com',
    },
  ];
  const confirms = [];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() });
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: entries.length ? entries : defaults.totpEntries };
        },
        async set(value) {
          const nextEntries = value.totpEntries ?? [];
          entries.splice(0, entries.length, ...nextEntries);
        },
      },
    },
  };
  globalThis.confirm = (message) => {
    confirms.push(message);
    return false;
  };

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);
  await new Promise((resolve) => setImmediate(resolve));

  const clearButton = elements['#dangerActions'].querySelector('.danger-clear-all');
  await clearButton.listeners.click();

  assert.equal(confirms[0], '确认清空本地保存的全部 TOTP 条目？这会删除所有条目、备注和匹配域名。');

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});

test('options page reports clearing all entries with a unified success message', async () => {
  const entries = [
    {
      id: 'otp_1',
      issuer: 'GitHub',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      domains: ['github.com'],
      label: 'GitHub: alice@example.com',
    },
  ];
  const elements = {
    '#status': fakeElement(),
    '#entries': fakeElement(),
    '#entryDetail': fakeElement(),
    '#dangerActions': fakeElement(),
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
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() });
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: entries.length ? entries : defaults.totpEntries };
        },
        async set(value) {
          const nextEntries = value.totpEntries ?? [];
          entries.splice(0, entries.length, ...nextEntries);
        },
      },
    },
  };
  globalThis.confirm = () => true;

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/options.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);
  await new Promise((resolve) => setImmediate(resolve));

  const clearButton = elements['#dangerActions'].querySelector('.danger-clear-all');
  await clearButton.listeners.click();

  assert.match(elements['#status'].textContent, /已清空全部条目/);

  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.confirm;
});
