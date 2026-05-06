import { normalizeEntry } from './core/importers.js';

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

export async function deleteEntry(id) {
  const entries = await getEntries();
  return saveEntries(entries.filter((entry) => entry.id !== id));
}

export async function clearEntries() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}
