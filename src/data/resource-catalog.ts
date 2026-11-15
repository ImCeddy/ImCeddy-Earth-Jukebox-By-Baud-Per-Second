export function normalizeResourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

export function collectUniqueSources<T extends { url: string; title: string }>(
  entries: { source: T; usedBy: string }[],
): (T & { usedBy: string[] })[] {
  const sources = new Map<string, { source: T; usedBy: Set<string> }>();
  for (const { source, usedBy } of entries) {
    const key = normalizeResourceUrl(source.url);
    const entry = sources.get(key) ?? { source, usedBy: new Set<string>() };
    entry.usedBy.add(usedBy);
    sources.set(key, entry);
  }
  return Array.from(sources.values(), ({ source, usedBy }) => ({
    ...source,
    usedBy: Array.from(usedBy).sort((a, b) => a.localeCompare(b)),
  })).sort((a, b) => a.title.localeCompare(b.title));
}
