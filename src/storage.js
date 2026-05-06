import { normalizeEntry } from './core/importers.js';
import { normalizeHost } from './core/matcher.js';

const STORAGE_KEY = 'totpEntries';

export async function getEntries() {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  return result[STORAGE_KEY].map((entry) => normalizeEntry(entry));
}

export async function saveEntries(entries) {
  const normalized = entries.map((entry) => normalizeEntry(entry));
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export async function addEntries(newEntries) {
  const existing = await getEntries();
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  for (const entry of newEntries.map((item) => normalizeEntry(item))) {
    byId.set(entry.id, entry);
  }
  return saveEntries([...byId.values()].sort((a, b) => a.label.localeCompare(b.label)));
}


export async function updateEntry(id, patch) {
  const entries = await getEntries();
  let found = false;
  const updated = entries.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return normalizeEntry({ ...entry, ...patch, id: entry.id, secret: entry.secret });
  });
  if (!found) {
    throw new Error('没有找到要更新的 TOTP 条目');
  }
  return saveEntries(updated.sort((a, b) => a.label.localeCompare(b.label)));
}

export async function addEntryDomain(id, urlOrHost) {
  const entry = (await getEntries()).find((item) => item.id === id);
  if (!entry) {
    throw new Error('没有找到要绑定的 TOTP 条目');
  }
  const domain = normalizeHost(urlOrHost);
  const domains = [...(entry.domains || [])];
  if (!domains.includes(domain)) domains.push(domain);
  return updateEntry(id, { domains });
}

export async function deleteEntry(id) {
  const entries = await getEntries();
  return saveEntries(entries.filter((entry) => entry.id !== id));
}

export async function clearEntries() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}
