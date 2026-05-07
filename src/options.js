import { addEntries, clearEntries, deleteEntry, getEntries, updateEntry } from './storage.js';
import { importAnyText } from './core/importers.js';

const statusEl = document.querySelector('#status');
const entriesEl = document.querySelector('#entries');
const entryDetailEl = document.querySelector('#entryDetail') || entriesEl;
const dangerActionsEl = document.querySelector('#dangerActions') || entryDetailEl;
const searchEl = document.querySelector('#search');
const importPreviewEl = document.querySelector('#importPreview');
const confirmImportEl = document.querySelector('#confirmImport');
let pendingImportText = '';
let pendingImportEntries = [];
let selectedEntryId = '';

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
    importPreviewEl.textContent = '选择文件或粘贴内容后，先预览将新增、覆盖或跳过的条目。';
  }
}

function classifyImportEntries(imported, existing) {
  const existingById = new Map(existing.map((entry) => [entry.id, entry]));
  return imported.map((entry) => {
    const current = existingById.get(entry.id);
    if (!current) {
      return { type: '新增', entry };
    }
    const importedText = JSON.stringify(entry);
    const currentText = JSON.stringify(current);
    return { type: importedText === currentText ? '重复' : '将覆盖', entry };
  });
}

async function renderImportPreview(imported) {
  const existing = await getEntries();
  const classified = classifyImportEntries(imported, existing);
  const newCount = classified.filter((item) => item.type === '新增').length;
  const overwriteCount = classified.filter((item) => item.type === '将覆盖').length;
  const duplicateCount = classified.filter((item) => item.type === '重复').length;
  const labels = classified
    .slice(0, 5)
    .map(({ type, entry }) => `${type}：${entry.issuer || entry.account || entry.label}`)
    .join('；');
  const more = classified.length > 5 ? `；另有 ${classified.length - 5} 个条目` : '';
  if (importPreviewEl) {
    importPreviewEl.textContent = `准备导入 ${imported.length} 个条目：新增 ${newCount} 个，将覆盖 ${overwriteCount} 个，重复 ${duplicateCount} 个。${labels}${more}`;
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
  setStatus(`已完成 ${imported.length} 个条目的导入预览，请确认后写入本地存储`);
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
  setStatus(`已导入并更新 ${imported.length} 个条目`);
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

function deleteEntryMessage(entry) {
  return `确认删除当前条目“${entry.label}”？这会移除它的备注和匹配域名。`;
}

function clearAllEntriesMessage() {
  return '确认清空本地保存的全部 TOTP 条目？这会删除所有条目、备注和匹配域名。';
}

async function saveEntryFromDetail(detail, entry) {
  const issuer = detail.querySelector('.edit-issuer').value;
  const account = detail.querySelector('.edit-account').value;
  const note = detail.querySelector('.edit-note').value;
  const domains = detail.querySelector('.edit-domains').value
    .split(/[\n,，]/)
    .map((domain) => domain.trim())
    .filter(Boolean);
  await updateEntry(entry.id, { issuer, account, note, domains });
  setStatus(`已保存条目：${issuer || account || entry.label}`);
  await renderEntries();
}

function renderEntrySummary(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `entry-list-item${entry.id === selectedEntryId ? ' active' : ''}`;
  button.innerHTML = `
    <span class="entry-title"></span>
    <span class="entry-subtitle"></span>
  `;
  button.querySelector('.entry-title').textContent = entry.issuer || entry.label;
  button.querySelector('.entry-subtitle').textContent = [
    entry.account || entry.label,
    domainsText(entry) || '未绑定匹配域名',
  ].filter(Boolean).join(' · ');
  button.addEventListener('click', () => {
    selectedEntryId = entry.id;
    renderEntries().catch((error) => setStatus(error.message, true));
  });
  return button;
}

function renderEntryDetail(entry) {
  const card = document.createElement('section');
  card.className = 'card stack entry-editor';
  card.innerHTML = `
    <div>
      <div class="entry-title"></div>
      <div class="entry-subtitle"></div>
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
  card.querySelector('.save').addEventListener('click', () => saveEntryFromDetail(card, entry).catch((error) => setStatus(error.message, true)));
  return card;
}

function renderDangerZone(entry) {
  const card = document.createElement('section');
  card.className = 'card stack danger-actions-card';
  card.innerHTML = `
    <div>
      <p class="eyebrow">危险操作</p>
      <h2>删除或清空</h2>
    </div>
    <p class="muted danger-copy"></p>
    <div class="small-actions danger-actions-list"></div>
  `;

  const copy = card.querySelector('.danger-copy');
  const actions = card.querySelector('.danger-actions-list');

  if (entry) {
    copy.textContent = '这些操作无法撤销。删除当前条目只影响当前选中的条目；清空全部会移除本地全部条目。';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger danger-delete-entry';
    deleteButton.textContent = '删除当前条目';
    deleteButton.addEventListener('click', async () => {
      const ok = confirm(deleteEntryMessage(entry));
      if (!ok) return;
      await deleteEntry(entry.id);
      selectedEntryId = '';
      setStatus(`已删除条目：${entry.label}`);
      await renderEntries();
    });
    actions.append(deleteButton);
  } else {
    copy.textContent = '当前没有可删除的条目；清空全部会移除本地全部条目。';
  }

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.id = 'clearAll';
  clearButton.className = 'danger danger-clear-all';
  clearButton.textContent = '清空全部条目';
  clearButton.addEventListener('click', async () => {
    const ok = confirm(clearAllEntriesMessage());
    if (!ok) return;
    await clearEntries();
    selectedEntryId = '';
    setStatus('已清空全部条目');
    await renderEntries();
  });
  actions.append(clearButton);

  dangerActionsEl.replaceChildren(card);
}

async function renderEntries() {
  const entries = (await getEntries()).filter((entry) => entryMatches(entry, searchEl.value.trim()));
  if (!entries.length) {
    selectedEntryId = '';
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = searchEl.value.trim() ? '没有找到匹配条目。' : '没有条目。';
    entriesEl.replaceChildren(empty);
    const hint = document.createElement('section');
    hint.className = 'card muted';
    hint.textContent = '选择左侧条目后，在这里编辑服务商、名称、备注和匹配域名。';
    entryDetailEl.replaceChildren(hint);
    renderDangerZone(null);
    return;
  }
  if (!entries.some((entry) => entry.id === selectedEntryId)) {
    selectedEntryId = entries[0].id;
  }
  entriesEl.replaceChildren(...entries.map((entry) => renderEntrySummary(entry)));
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId);
  entryDetailEl.replaceChildren(renderEntryDetail(selectedEntry));
  renderDangerZone(selectedEntry);
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

confirmImportEl?.addEventListener('click', () => confirmImport().catch((error) => setStatus(error.message, true)));
searchEl.addEventListener('input', renderEntries);
clearImportPreview();
renderEntries().catch((error) => setStatus(error.message, true));
