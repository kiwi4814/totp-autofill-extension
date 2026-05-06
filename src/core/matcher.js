const COMMON_PREFIXES = /^(www|m|login|auth|accounts|account|signin)\./i;

export function normalizeHost(value) {
  const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
  return url.hostname.toLowerCase().replace(COMMON_PREFIXES, '');
}

function hostTokens(host) {
  const parts = normalizeHost(host).split('.').filter(Boolean);
  const withoutPublicSuffix = parts.length >= 2 ? parts.slice(0, -1) : parts;
  return new Set(withoutPublicSuffix.flatMap((part) => part.split(/[-_]/)).filter((part) => part.length > 2));
}

function searchableEntryText(entry) {
  return [entry.issuer, entry.account, entry.label, entry.note, ...(entry.domains || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function issuerToDomainToken(issuer) {
  if (!issuer) return '';
  const normalized = issuer.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length >= 3 ? normalized : '';
}

function scoreEntry(entry, host) {
  const normalizedHost = normalizeHost(host);
  const domains = entry.domains || [];
  if (domains.some((domain) => normalizedHost === normalizeHost(domain) || normalizedHost.endsWith(`.${normalizeHost(domain)}`))) {
    return 100;
  }
  const text = searchableEntryText(entry);
  if (text.includes(normalizedHost)) return 80;
  const issuerToken = issuerToDomainToken(entry.issuer);
  if (issuerToken && normalizedHost.includes(issuerToken)) return 70;
  let score = 0;
  for (const token of hostTokens(normalizedHost)) {
    if (text.includes(token)) score += 10;
  }
  return score;
}

export function findEntriesForHost(entries, urlOrHost) {
  return [...entries]
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, urlOrHost) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
}
