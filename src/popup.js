import { getEntries } from './storage.js';
import { generateTotp, getTimeRemaining } from './core/totp.js';
import { findEntriesForHost } from './core/matcher.js';

const entriesEl = document.querySelector('#entries');
const statusEl = document.querySelector('#status');
const hostEl = document.querySelector('#host');
const codeCache = new Map();
let currentTab = null;
let currentEntries = [];

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
  setStatus('已填充到当前页面');
}

function renderEmpty(message) {
  entriesEl.innerHTML = `<div class="card"><p>${message}</p><p class="muted">可以在“导入/管理”里导入 Aegis JSON 或 Google Authenticator 迁移二维码内容。</p></div>`;
}

async function codeFor(entry) {
  const bucket = Math.floor(Date.now() / 1000 / entry.period);
  const key = `${entry.id}:${bucket}`;
  if (!codeCache.has(key)) {
    codeCache.clear();
    codeCache.set(key, await generateTotp(entry));
  }
  return codeCache.get(key);
}

async function renderEntries() {
  if (!currentEntries.length) {
    renderEmpty('当前网站没有匹配的 2FA 条目。');
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
        <button class="primary fill">填充当前网站</button>
        <button class="copy">复制</button>
      </div>
    `;
    card.querySelector('.entry-title').textContent = entry.issuer || entry.label;
    card.querySelector('.entry-subtitle').textContent = entry.account || entry.label;
    card.querySelector('.code').textContent = code;
    card.querySelector('.countdown').textContent = `${remaining}s`;
    card.querySelector('.copy').addEventListener('click', () => copyCode(code).catch((error) => setStatus(error.message, true)));
    card.querySelector('.fill').addEventListener('click', () => fillCode(code).catch((error) => setStatus(error.message, true)));
    return card;
  }));
}

async function init() {
  document.querySelector('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  currentTab = await getActiveTab();
  const url = currentTab?.url || '';
  hostEl.textContent = url ? new URL(url).hostname : '无法读取当前网站';
  const entries = await getEntries();
  if (!entries.length) {
    renderEmpty('还没有导入 2FA 条目。');
    return;
  }
  currentEntries = findEntriesForHost(entries, url);
  await renderEntries();
  setInterval(renderEntries, 1000);
}

init().catch((error) => {
  setStatus(error.message, true);
  renderEmpty('插件初始化失败。');
});
