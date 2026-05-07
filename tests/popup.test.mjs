import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function makeElement(initial = {}) {
  const element = {
    tagName: initial.tagName || 'DIV',
    id: initial.id || '',
    className: initial.className || '',
    textContent: initial.textContent || '',
    value: initial.value || '',
    type: initial.type || '',
    placeholder: initial.placeholder || '',
    children: [],
    listeners: {},
    classList: {
      toggle() {},
    },
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
      return this._innerHTML || '';
    },
    set(value) {
      this._innerHTML = value;
      this.children = [];
      if (value.includes('entry-title')) this.children.push(makeElement({ className: 'entry-title' }));
      if (value.includes('entry-subtitle')) this.children.push(makeElement({ className: 'entry-subtitle' }));
      if (value.includes('code')) this.children.push(makeElement({ className: 'code' }));
      if (value.includes('countdown')) this.children.push(makeElement({ className: 'countdown muted' }));
      if (value.includes('countdown-bar-fill')) this.children.push(makeElement({ className: 'countdown-bar-fill' }));
      if (value.includes('countdown-hint')) this.children.push(makeElement({ className: 'countdown-hint muted' }));
      if (value.includes('primary fill')) this.children.push(makeElement({ tagName: 'BUTTON', className: 'primary fill' }));
      if (value.includes('button class="copy"')) this.children.push(makeElement({ tagName: 'BUTTON', className: 'copy' }));
    },
  });

  return element;
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setupPopup(entries, { url = 'https://vault-nowhere.test/login', sendMessageResult = { ok: true, mode: 'single' }, now = 1714953600000 } = {}) {
  let storedEntries = structuredClone(entries);
  const sentMessages = [];
  const injectedScripts = [];

  const elements = {
    '#entries': makeElement({ id: 'entries', className: 'list' }),
    '#status': makeElement({ id: 'status', className: 'status' }),
    '#host': makeElement({ id: 'host', className: 'muted' }),
    '#openOptions': makeElement({ id: 'openOptions' }),
  };

  globalThis.document = {
    querySelector(selector) {
      return elements[selector] || null;
    },
    createElement(tagName) {
      return makeElement({ tagName: tagName.toUpperCase() });
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { totpEntries: storedEntries.length ? structuredClone(storedEntries) : defaults.totpEntries };
        },
        async set(value) {
          storedEntries = structuredClone(value.totpEntries);
        },
      },
    },
    tabs: {
      async query() {
        return [{ id: 7, url }];
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
        return sendMessageResult;
      },
    },
    scripting: {
      async executeScript(payload) {
        injectedScripts.push(payload);
      },
    },
    runtime: {
      openOptionsPage() {},
    },
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText() {},
      },
    },
  });
  globalThis.setInterval = () => 1;
  globalThis.Date.now = () => now;

  const moduleUrl = `${pathToFileURL('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/popup.js').href}?test=${Date.now()}_${Math.random()}`;
  await import(moduleUrl);
  await flush();
  await flush();

  return {
    elements,
    sentMessages,
    injectedScripts,
    getStoredEntries: () => structuredClone(storedEntries),
  };
}

function cleanupGlobals() {
  delete globalThis.document;
  delete globalThis.chrome;
  delete globalThis.navigator;
}

const baseEntries = [
  {
    id: 'otp_1',
    issuer: 'Acme',
    account: 'alice@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    domains: ['signin.acme.test'],
    label: 'Acme: alice@example.com',
  },
  {
    id: 'otp_2',
    issuer: 'Contoso',
    account: 'ops-team',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    domains: ['portal.contoso.test'],
    label: 'Contoso: ops-team',
  },
];

test('popup status region announces updates accessibly', async () => {
  const html = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/popup.html', 'utf8');

  assert.match(html, /id="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="status"[^>]*role="status"/);
});

test('popup styles keep interactive controls at accessible touch target sizes', async () => {
  const css = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/styles.css', 'utf8');

  assert.match(css, /button, \.button-like \{[\s\S]*min-height: 44px;/);
  assert.match(css, /textarea, input\[type="search"\], input\[type="text"\], input\[type="password"\] \{[\s\S]*min-height: 44px;/);
});

test('popup styles expose clear keyboard focus states', async () => {
  const css = await readFile('/Users/heqifeng/VibeCoding/totp-autofill-extension/src/styles.css', 'utf8');

  assert.match(css, /button:focus-visible, \.button-like:focus-visible, textarea:focus-visible, input\[type="search"\]:focus-visible, input\[type="text"\]:focus-visible, input\[type="password"\]:focus-visible \{/);
  assert.match(css, /button:focus-visible, \.button-like:focus-visible, textarea:focus-visible, input\[type="search"\]:focus-visible, input\[type="text"\]:focus-visible, input\[type="password"\]:focus-visible \{[\s\S]*outline:/);
  assert.match(css, /button:focus-visible, \.button-like:focus-visible, textarea:focus-visible, input\[type="search"\]:focus-visible, input\[type="text"\]:focus-visible, input\[type="password"\]:focus-visible \{[\s\S]*outline-offset:/);
});

test('popup empty state explains how to import entries when storage is empty', async () => {
  const { elements } = await setupPopup([]);

  assert.match(elements['#entries'].children[0].children[0].textContent, /还没有导入 2FA 条目/);
  assert.match(elements['#entries'].children[0].children[1].textContent, /点击上方“导入\/管理”/);

  cleanupGlobals();
});

test('popup shows actionable fill error copy when the page rejects autofill', async () => {
  const { elements } = await setupPopup([baseEntries[0]], { sendMessageResult: { ok: false, error: '当前页面没有找到验证码输入框' } });
  const fillButton = elements['#entries'].children
    .filter((child) => String(child.className).includes('entry-card'))[0]
    .querySelector('.fill');

  await fillButton.listeners.click();
  await flush();

  assert.match(elements['#status'].textContent, /当前页面没有找到验证码输入框/);
  assert.match(elements['#status'].textContent, /复制验证码后手动粘贴/);

  cleanupGlobals();
});

test('single matched entry emphasizes the primary fill action', async () => {
  const { elements } = await setupPopup([baseEntries[0]], { url: 'https://signin.acme.test/login' });
  const entryCards = elements['#entries'].children.filter((child) => String(child.className).includes('entry-card'));
  const fillButton = entryCards[0].querySelector('.fill');
  const copyButton = entryCards[0].querySelector('.copy');

  assert.equal(entryCards.length, 1);
  assert.equal(fillButton.textContent, '立即填充当前网站');
  assert.equal(copyButton.textContent, '复制备用');
  assert.match(elements['#status'].textContent, /已匹配当前网站/);
  assert.match(elements['#status'].textContent, /可直接填充，也可复制备用/);

  cleanupGlobals();
});

test('unmatched popup shows search controls and the default recommended list', async () => {
  const { elements } = await setupPopup(baseEntries);

  assert.match(elements['#status'].textContent, /当前网站还没有自动匹配/);
  assert.match(elements['#status'].textContent, /搜索并选择正确条目后，会保存域名绑定/);
  assert.equal(elements['#host'].textContent, 'vault-nowhere.test');
  assert.ok(elements['#entries'].querySelector('.popup-search-input'));
  assert.equal(elements['#entries'].querySelector('.popup-search-input').placeholder, '搜索服务商 / 名称 / 匹配域名');
  assert.equal(elements['#entries'].children.filter((child) => String(child.className).includes('entry-card')).length, 2);

  cleanupGlobals();
});

test('unmatched popup search filters by issuer, account, and domain', async () => {
  const { elements } = await setupPopup(baseEntries);
  const searchInput = elements['#entries'].querySelector('.popup-search-input');

  searchInput.value = 'contoso';
  await searchInput.listeners.input({ target: searchInput });
  await flush();
  assert.deepEqual(
    elements['#entries'].children
      .filter((child) => String(child.className).includes('entry-card'))
      .map((child) => child.querySelector('.entry-title').textContent),
    ['Contoso'],
  );

  searchInput.value = 'alice@example.com';
  await searchInput.listeners.input({ target: searchInput });
  await flush();
  assert.deepEqual(
    elements['#entries'].children
      .filter((child) => String(child.className).includes('entry-card'))
      .map((child) => child.querySelector('.entry-title').textContent),
    ['Acme'],
  );

  searchInput.value = 'portal.contoso.test';
  await searchInput.listeners.input({ target: searchInput });
  await flush();
  assert.deepEqual(
    elements['#entries'].children
      .filter((child) => String(child.className).includes('entry-card'))
      .map((child) => child.querySelector('.entry-title').textContent),
    ['Contoso'],
  );

  cleanupGlobals();
});

test('multiple matched entries show a match summary and searchable list', async () => {
  const entries = [
    { ...baseEntries[0], domains: ['shared.test'] },
    { ...baseEntries[1], domains: ['shared.test'] },
  ];
  const { elements } = await setupPopup(entries, { url: 'https://shared.test/login' });
  const searchInput = elements['#entries'].querySelector('.popup-search-input');

  assert.match(elements['#status'].textContent, /当前网站匹配到 2 个条目/);
  assert.match(elements['#status'].textContent, /你也可以先搜索再填充/);
  assert.equal(searchInput.placeholder, '搜索服务商 / 名称 / 匹配域名');

  searchInput.value = 'contoso';
  await searchInput.listeners.input({ target: searchInput });
  await flush();

  assert.deepEqual(
    elements['#entries'].children
      .filter((child) => String(child.className).includes('entry-card'))
      .map((child) => child.querySelector('.entry-title').textContent),
    ['Contoso'],
  );

  cleanupGlobals();
});

test('popup warns when the current code is about to refresh', async () => {
  const { elements } = await setupPopup([baseEntries[0]], {
    url: 'https://signin.acme.test/login',
    now: 1714953625000,
  });
  const entryCard = elements['#entries'].children
    .filter((child) => String(child.className).includes('entry-card'))[0];

  assert.match(entryCard.querySelector('.countdown-hint').textContent, /验证码即将刷新/);
  assert.match(entryCard.querySelector('.countdown-hint').textContent, /复制备用/);

  cleanupGlobals();
});

test('popup explains the recovery path when it cannot read the current site', async () => {
  const { elements } = await setupPopup([baseEntries[0]], { url: 'about:blank' });

  assert.equal(elements['#host'].textContent, '无法读取当前网站');
  assert.match(elements['#status'].textContent, /无法读取当前网站/);
  assert.match(elements['#status'].textContent, /去设置页管理条目/);
  assert.match(elements['#status'].textContent, /复制验证码后手动使用/);

  cleanupGlobals();
});

test('unmatched popup bind-and-fill saves the selected host and sends the code', async () => {
  const { elements, getStoredEntries, sentMessages, injectedScripts } = await setupPopup(baseEntries);
  const fillButtons = elements['#entries'].children
    .filter((child) => String(child.className).includes('entry-card'))
    .map((child) => child.querySelector('.fill'));

  await fillButtons[1].listeners.click();
  await flush();

  assert.equal(injectedScripts.length, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].message.type, 'FILL_TOTP_CODE');
  assert.match(sentMessages[0].message.code, /^\d{6}$/);
  assert.deepEqual(getStoredEntries()[1].domains, ['portal.contoso.test', 'vault-nowhere.test']);
  assert.match(elements['#status'].textContent, /已绑定 vault-nowhere.test/);
  assert.match(elements['#status'].textContent, /下次可直接匹配/);

  cleanupGlobals();
});
