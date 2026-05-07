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
let searchQuery = '';

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function fillErrorMessage(message = '填充失败') {
  return `${message}；你可以复制验证码后手动粘贴。`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function copyCode(code) {
  await navigator.clipboard.writeText(code);
  setStatus('已复制验证码，可手动粘贴');
}

async function fillCode(code) {
  if (!currentTab?.id) throw new Error(fillErrorMessage('无法定位当前标签页'));
  await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['src/content/autofill.js'] });
  const response = await chrome.tabs.sendMessage(currentTab.id, { type: 'FILL_TOTP_CODE', code });
  if (!response?.ok) throw new Error(fillErrorMessage(response?.error || '填充失败'));
  setStatus(response.mode === 'split' ? '已填充到验证码输入框组' : '已填充到当前网站');
}

async function bindAndFill(entry, code) {
  if (currentHost) {
    await addEntryDomain(entry.id, currentHost);
  }
  await fillCode(code);
  if (currentHost) setStatus(`已绑定 ${currentHost}，下次可直接匹配`);
}

function renderEmpty(message, hint = '点击上方“导入/管理”导入 Aegis JSON、迁移二维码或手动粘贴 otpauth 内容。') {
  const card = document.createElement('div');
  card.className = 'card';

  const messageEl = document.createElement('p');
  messageEl.textContent = message;

  const hintEl = document.createElement('p');
  hintEl.className = 'muted';
  hintEl.textContent = hint;

  card.append(messageEl, hintEl);
  entriesEl.replaceChildren(card);
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

function entryMatchesQuery(entry, query) {
  if (!query) return true;
  return [entry.issuer, entry.account, entry.label, ...(entry.domains || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query.toLowerCase());
}

function visibleEntries() {
  return currentEntries.filter((entry) => entryMatchesQuery(entry, searchQuery));
}

function renderSearchControls() {
  const controls = document.createElement('section');
  controls.className = 'card stack popup-search-controls';

  const intro = document.createElement('p');
  intro.textContent = fallbackMode
    ? '当前网站还没有自动匹配，先搜索正确条目，再一键绑定并填充。'
    : '当前网站匹配到多个条目，可搜索服务商、名称或匹配域名后再填充。';

  const input = document.createElement('input');
  input.className = 'popup-search-input';
  input.type = 'search';
  input.placeholder = '搜索服务商 / 名称 / 匹配域名';
  input.value = searchQuery;
  input.addEventListener('input', (event) => {
    searchQuery = event.target.value.trim();
    renderEntries().catch((error) => setStatus(error.message, true));
  });

  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = fallbackMode
    ? '绑定只保存域名，不保存当前页面路径。'
    : '默认按当前网站匹配评分排序，最近要用的条目可以直接填充。';

  controls.append(intro, input, hint);
  return controls;
}

async function renderEntries() {
  const entries = visibleEntries();
  if (!entries.length) {
    if (fallbackMode) {
      const children = [renderSearchControls()];
      const empty = document.createElement('div');
      empty.className = 'card';
      const message = document.createElement('p');
      message.className = 'muted';
      message.textContent = '没有找到匹配条目';
      empty.append(message);
      children.push(empty);
      entriesEl.replaceChildren(...children);
      return;
    }
    renderEmpty('还没有可用的 2FA 条目。');
    return;
  }

  const cards = await Promise.all(entries.map(async (entry) => {
    const code = await codeFor(entry);
    const remaining = getTimeRemaining({ period: entry.period });
    return { entry, code, remaining };
  }));

  entriesEl.replaceChildren(
    ...[
      ...(fallbackMode || currentEntries.length > 1 ? [renderSearchControls()] : []),
      ...cards.map(({ entry, code, remaining }) => {
        const card = document.createElement('section');
        card.className = 'card stack entry-card';
        card.innerHTML = `
          <div>
            <div class="entry-title"></div>
            <div class="entry-subtitle"></div>
          </div>
          <div class="row">
            <div class="code"></div>
            <div class="muted countdown"></div>
          </div>
          <div class="countdown-track" aria-hidden="true">
            <div class="countdown-bar-fill"></div>
          </div>
          <div class="countdown-hint muted"></div>
          <div class="small-actions">
            <button class="primary fill"></button>
            <button class="copy">复制</button>
          </div>
        `;
        card.querySelector('.entry-title').textContent = entry.issuer || entry.label;
        card.querySelector('.entry-subtitle').textContent = entry.account || entry.label;
        card.querySelector('.code').textContent = code;
        card.querySelector('.countdown').textContent = `${remaining}秒`;
        const progress = card.querySelector('.countdown-bar-fill');
        if (progress) progress.style = `width: ${Math.max(0, Math.min(100, (remaining / entry.period) * 100))}%`;
        const countdownHint = card.querySelector('.countdown-hint');
        if (countdownHint) {
          countdownHint.textContent = remaining <= 7
            ? '验证码即将刷新，建议先复制备用，或稍等下一组再填充。'
            : '如自动填充失败，可以复制验证码手动粘贴。';
        }
        const fillButton = card.querySelector('.fill');
        fillButton.textContent = fallbackMode
          ? `绑定 ${currentHost || '当前网站'} 并填充`
          : currentEntries.length === 1
            ? '立即填充当前网站'
            : '填充当前网站';
        fillButton.addEventListener('click', () => {
          const action = fallbackMode ? bindAndFill(entry, code) : fillCode(code);
          action.catch((error) => setStatus(error.message, true));
        });
        const copyButton = card.querySelector('.copy');
        copyButton.textContent = currentEntries.length === 1 && !fallbackMode ? '复制备用' : '复制';
        copyButton.addEventListener('click', () => copyCode(code).catch((error) => setStatus(error.message, true)));
        return card;
      }),
    ],
  );
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
  searchQuery = '';
  if (fallbackMode) {
    setStatus('当前网站还没有自动匹配；搜索并选择正确条目后，会保存域名绑定。');
  } else if (matches.length === 1) {
    setStatus('已匹配当前网站；可直接填充，也可复制备用。');
  } else if (matches.length > 1) {
    setStatus(`当前网站匹配到 ${matches.length} 个条目；你也可以先搜索再填充。`);
  } else if (!currentHost) {
    setStatus('无法读取当前网站；你可以去设置页管理条目，或复制验证码后手动使用。');
  }
  await renderEntries();
  setInterval(renderEntries, 1000);
}

init().catch((error) => {
  setStatus(error.message, true);
  renderEmpty('插件初始化失败。');
});
