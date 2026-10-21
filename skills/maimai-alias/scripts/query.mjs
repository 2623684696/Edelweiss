import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'https://maimai.lxns.net/api/v0/maimai/';
const normalize = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

export function search(query, songs, aliasRows) {
  const term = normalize(query);
  if (!term) throw new Error('A non-empty song title, alias, or ID is required.');
  if (!Array.isArray(songs) || !Array.isArray(aliasRows)
    || songs.some(s => !Number.isSafeInteger(s?.id) || typeof s.title !== 'string' || typeof s.artist !== 'string')
    || aliasRows.some(a => !Number.isSafeInteger(a?.song_id) || !Array.isArray(a.aliases) || a.aliases.some(v => typeof v !== 'string')))
    throw new Error('Unexpected LXNS song or alias response schema.');

  const numericId = /^\d+$/u.test(term) ? Number(term) : null;
  const id = numericId !== null && Number.isSafeInteger(numericId)
    ? (numericId >= 10000 && numericId < 100000 ? numericId % 10000 : numericId)
    : null;
  const records = new Map(songs.map(s => [s.id, {
    song_id: s.id, title: s.title, artist: s.artist, aliases: [],
  }]));
  for (const row of aliasRows) {
    const record = records.get(row.song_id) ?? { song_id: row.song_id, title: null, artist: null, aliases: [] };
    record.aliases = [...new Set([...record.aliases, ...row.aliases])];
    records.set(row.song_id, record);
  }
  const all = [...records.values()].sort((a, b) => a.song_id - b.song_id);
  const exact = all.filter(s => s.song_id === id || (s.title !== null && normalize(s.title) === term)
    || s.aliases.some(a => normalize(a) === term));
  const match = exact.length ? 'exact' : 'partial';
  const matches = exact.length ? exact : all.filter(s => (s.title !== null && normalize(s.title).includes(term))
    || s.aliases.some(a => normalize(a).includes(term)));
  return {
    ok: true, query, normalized_id: id, match: matches.length ? match : 'none',
    total: matches.length, truncated: matches.length > 5,
    matches: matches.slice(0, 5).map(s => ({
      ...s, aliases: s.aliases.slice(0, 12), alias_count: s.aliases.length,
      aliases_truncated: s.aliases.length > 12,
      matched_aliases: s.aliases.filter(a => match === 'exact' ? normalize(a) === term : normalize(a).includes(term)).slice(0, 12),
    })),
  };
}

export async function queryRemote(query, fetcher = fetch) {
  if (typeof query !== 'string' || !normalize(query)) throw new Error('A non-empty query is required.');
  const get = async path => {
    const response = await fetcher(BASE + path, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`LXNS ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const [songs, aliases] = await Promise.all([get('song/list'), get('alias/list')]);
  return { ...search(query, songs?.songs, aliases?.aliases), source: BASE, fetched_at: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node query.mjs <song title, alias, or ID>');
    console.log(JSON.stringify(await queryRemote(process.argv[2])));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
