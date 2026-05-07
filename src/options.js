import { addEntries, clearEntries, deleteEntry, getEntries, updateEntry } from './storage.js';
import { importAnyText } from './core/importers.js';

const statusEl = document.querySelector('#status');
const entriesEl = document.querySelector('#entries');
const searchEl = document.querySelector('#search');
const importPreviewEl = document.querySelector('#importPreview');
const confirmImportEl = document.querySelector('#confirmImport');
let pendingImportText = '';
let pendingImportEntries = [];

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setConfirmImportEnabled(enabled) {
  if (confirmImportEl) confirmImportEl.disabled = !enabled;
}

function clearImportPreview() {
  pendingImportEntries = [];
  setConfirmImportEnabled(false);
  if (importPreviewEl) {
    importPreviewEl.textContent = '选择文件或粘贴内容后，先预览将新增或更新的条目。';
  }
}

async function renderImportPreview(imported) {
  const existing = await getEntries();
  const existingIds = new Set(existing.map((entry) => entry.id));
  const newCount = imported.filter((entry) => !existingIds.has(entry.id)).length;
  const updateCount = imported.length - newCount;
  const labels = imported
    .slice(0, 5)
    .map((entry) => `${existingIds.has(entry.id) ? '更新' : '新增'}：${entry.issuer || entry.account || entry.label}`)
    .join('；');
  const more = imported.length > 5 ? `；另有 ${imported.length - 5} 个条目` : '';
  if (importPreviewEl) {
    importPreviewEl.textContent = `准备导入 ${imported.length} 个条目：新增 ${newCount} 个，更新 ${updateCount} 个。${labels}${more}`;
  }
}

async function previewImportText(text) {
  pendingImportText = text;
  pendingImportEntries = [];
  setConfirmImportEnabled(false);
  if (importPreviewEl) importPreviewEl.textContent = '正在读取/解密，请稍候...';
  setStatus('正在读取/解密，请稍候...');
  const imported = await importAnyText(text, { password: document.querySelector('#aegisPassword').value });
  if (!imported.length) throw new Error('没有找到可导入的 TOTP 条目');
  pendingImportEntries = imported;
  await renderImportPreview(imported);
  setConfirmImportEnabled(true);
  setStatus(`已预览 ${imported.length} 个条目，请确认后写入本地存储`);
}

async function confirmImport() {
  if (!pendingImportEntries.length) {
    setStatus('没有待写入的导入预览', true);
    return;
  }
  const imported = pendingImportEntries;
  await addEntries(imported);
  pendingImportText = '';
  clearImportPreview();
  setStatus(`已导入/更新 ${imported.length} 个条目`);
  await renderEntries();
}

async function readFile(file) {
  return file.text();
}

async function decodeQrImage(file) {
  if (!('BarcodeDetector' in globalThis)) {
    throw new Error('当前 Chrome 不支持内置二维码识别。请用其他工具读取二维码内容后粘贴 otpauth-migration://...');
  }
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  const bitmap = await createImageBitmap(file);
  const codes = await detector.detect(bitmap);
  bitmap.close?.();
  const value = codes[0]?.rawValue;
  if (!value) throw new Error('图片中没有识别到二维码');
  return value;
}

function entryMatches(entry, query) {
  if (!query) return true;
  return [entry.issuer, entry.account, entry.label, entry.note, ...(entry.domains || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query.toLowerCase());
}

function domainsText(entry) {
  return (entry.domains || []).join(', ');
}

async function saveCard(card, entry) {
  const issuer = card.querySelector('.edit-issuer').value;
  const account = card.querySelector('.edit-account').value;
  const note = card.querySelector('.edit-note').value;
  const domains = card.querySelector('.edit-domains').value
    .split(/[\n,，]/)
    .map((domain) => domain.trim())
    .filter(Boolean);
  await updateEntry(entry.id, { issuer, account, note, domains });
  setStatus(`已保存 ${issuer || account || entry.label}`);
  await renderEntries();
}

async function renderEntries() {
  const entries = (await getEntries()).filter((entry) => entryMatches(entry, searchEl.value.trim()));
  if (!entries.length) {
    entriesEl.innerHTML = '<p class="muted">没有条目。</p>';
    return;
  }
  entriesEl.replaceChildren(...entries.map((entry) => {
    const card = document.createElement('section');
    card.className = 'card stack entry-editor';
    card.innerHTML = `
      <div class="row">
        <div>
          <div class="entry-title"></div>
          <div class="entry-subtitle"></div>
        </div>
        <button class="danger delete">删除</button>
      </div>
      <label>服务商 <input class="edit-issuer" type="text"></label>
      <label>名称 <input class="edit-account" type="text"></label>
      <label>备注 <input class="edit-note" type="text"></label>
      <label>匹配域名 <textarea class="edit-domains" placeholder="github.com, login.example.com"></textarea></label>
      <div class="small-actions">
        <button class="primary save">保存信息</button>
      </div>
    `;
    card.querySelector('.entry-title').textContent = entry.label;
    card.querySelector('.entry-subtitle').textContent = `哈希函数: ${entry.algorithm} · 位数: ${entry.digits} · 时间间隔: ${entry.period}秒`;
    card.querySelector('.edit-issuer').value = entry.issuer || '';
    card.querySelector('.edit-account').value = entry.account || '';
    card.querySelector('.edit-note').value = entry.note || '';
    card.querySelector('.edit-domains').value = domainsText(entry);
    card.querySelector('.save').addEventListener('click', () => saveCard(card, entry).catch((error) => setStatus(error.message, true)));
    card.querySelector('.delete').addEventListener('click', async () => {
      await deleteEntry(entry.id);
      setStatus(`已删除 ${entry.label}`);
      await renderEntries();
    });
    return card;
  }));
}

document.querySelector('#importButton').addEventListener('click', async () => {
  try {
    const text = pendingImportText || document.querySelector('#importText').value;
    await previewImportText(text);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#fileImport').addEventListener('change', async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    await previewImportText(await readFile(file));
    event.target.value = '';
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#qrImport').addEventListener('change', async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    const value = await decodeQrImage(file);
    await previewImportText(value);
    event.target.value = '';
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#clearAll').addEventListener('click', async () => {
  const ok = confirm('确认清空本地保存的所有 TOTP 条目？');
  if (!ok) return;
  await clearEntries();
  setStatus('已清空');
  await renderEntries();
});

confirmImportEl?.addEventListener('click', () => confirmImport().catch((error) => setStatus(error.message, true)));
searchEl.addEventListener('input', renderEntries);
clearImportPreview();
renderEntries().catch((error) => setStatus(error.message, true));
