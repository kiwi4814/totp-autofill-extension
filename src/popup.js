import { addEntryDomain, getEntries } from './storage.js';
import { generateTotp, getTimeRemaining } from './core/totp.js';
import { findEntriesForHost, normalizeHost } from './core/matcher.js';

const entriesEl = document.querySelector('#entries');
const statusEl = document.querySelector('#status');
const hostEl = document.querySelector('#host');
const codeCache = new Map();
let currentTab = null;
let currentHost = '';
let currentEntries = [];
let fallbackMode = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function copyCode(code) {
  await navigator.clipboard.writeText(code);
  setStatus('验证码已复制');
}

async function fillCode(code) {
  if (!currentTab?.id) throw new Error('无法定位当前标签页');
  await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['src/content/autofill.js'] });
  const response = await chrome.tabs.sendMessage(currentTab.id, { type: 'FILL_TOTP_CODE', code });
  if (!response?.ok) throw new Error(response?.error || '填充失败');
  setStatus(response.mode === 'split' ? '已填充到多格验证码输入框' : '已填充到当前页面');
}

async function bindAndFill(entry, code) {
  if (currentHost) {
    await addEntryDomain(entry.id, currentHost);
  }
  await fillCode(code);
  if (currentHost) setStatus(`已绑定 ${currentHost} 并填充`);
}

function renderEmpty(message, hint = '可以在“导入/管理”里导入 Aegis JSON 或 Google Authenticator 迁移二维码内容。') {
  entriesEl.innerHTML = `<div class="card"><p>${message}</p><p class="muted">${hint}</p></div>`;
}

async function codeFor(entry) {
  const bucket = Math.floor(Date.now() / 1000 / entry.period);
  const key = `${entry.id}:${bucket}`;
  if (!codeCache.has(key)) {
    codeCache.set(key, await generateTotp(entry));
  }
  for (const cachedKey of codeCache.keys()) {
    if (!cachedKey.endsWith(`:${bucket}`)) codeCache.delete(cachedKey);
  }
  return codeCache.get(key);
}

async function renderEntries() {
  if (!currentEntries.length) {
    renderEmpty('还没有可用的 2FA 条目。');
    return;
  }

  const cards = await Promise.all(currentEntries.map(async (entry) => {
    const code = await codeFor(entry);
    const remaining = getTimeRemaining({ period: entry.period });
    return { entry, code, remaining };
  }));

  entriesEl.replaceChildren(...cards.map(({ entry, code, remaining }) => {
    const card = document.createElement('section');
    card.className = 'card stack';
    card.innerHTML = `
      <div>
        <div class="entry-title"></div>
        <div class="entry-subtitle"></div>
      </div>
      <div class="row">
        <div class="code"></div>
        <div class="muted countdown"></div>
      </div>
      <div class="small-actions">
        <button class="primary fill"></button>
        <button class="copy">复制</button>
      </div>
    `;
    card.querySelector('.entry-title').textContent = entry.issuer || entry.label;
    card.querySelector('.entry-subtitle').textContent = entry.account || entry.label;
    card.querySelector('.code').textContent = code;
    card.querySelector('.countdown').textContent = `${remaining}s`;
    card.querySelector('.copy').addEventListener('click', () => copyCode(code).catch((error) => setStatus(error.message, true)));
    const fillButton = card.querySelector('.fill');
    fillButton.textContent = fallbackMode ? `绑定 ${currentHost || '当前网站'} 并填充` : '填充当前网站';
    fillButton.addEventListener('click', () => {
      const action = fallbackMode ? bindAndFill(entry, code) : fillCode(code);
      action.catch((error) => setStatus(error.message, true));
    });
    return card;
  }));
}

async function init() {
  document.querySelector('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  currentTab = await getActiveTab();
  const url = currentTab?.url || '';
  try {
    currentHost = url ? normalizeHost(url) : '';
  } catch (_error) {
    currentHost = '';
  }
  hostEl.textContent = currentHost || '无法读取当前网站';
  const entries = await getEntries();
  if (!entries.length) {
    renderEmpty('还没有导入 2FA 条目。');
    return;
  }
  const matches = currentHost ? findEntriesForHost(entries, currentHost) : [];
  fallbackMode = currentHost && matches.length === 0;
  currentEntries = fallbackMode ? entries : matches;
  if (fallbackMode) {
    setStatus('当前网站没有自动匹配；选择正确条目后会保存域名绑定。');
  }
  await renderEntries();
  setInterval(renderEntries, 1000);
}

init().catch((error) => {
  setStatus(error.message, true);
  renderEmpty('插件初始化失败。');
});
