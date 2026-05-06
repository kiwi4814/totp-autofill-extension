import { addEntries, clearEntries, deleteEntry, getEntries, updateEntry } from './storage.js';
import { importAnyText } from './core/importers.js';

const statusEl = document.querySelector('#status');
const entriesEl = document.querySelector('#entries');
const searchEl = document.querySelector('#search');

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function importText(text) {
  setStatus('正在导入/解密，请稍候...');
  const imported = await importAnyText(text, { password: document.querySelector('#aegisPassword').value });
  if (!imported.length) throw new Error('没有找到可导入的 TOTP 条目');
  await addEntries(imported);
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
    await importText(document.querySelector('#importText').value);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#fileImport').addEventListener('change', async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    await importText(await readFile(file));
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
    await importText(value);
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

searchEl.addEventListener('input', renderEntries);
renderEntries().catch((error) => setStatus(error.message, true));
