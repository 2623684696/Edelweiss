import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queryRemote, search } from './query.mjs';

const songs = [
  { id: 8, title: 'True Love Song', artist: 'Kai' },
  { id: 9, title: 'Other', artist: 'Artist' },
  { id: 100008, title: 'Party', artist: 'Artist' },
];
const aliases = [{ song_id: 8, aliases: ['love', 'shared'] }, { song_id: 9, aliases: ['shared', 'lovely'] }];

test('exact aliases beat partial matches; normalized titles resolve', () => {
  assert.deepEqual(search('LOVE', songs, aliases).matches.map(s => s.song_id), [8]);
  assert.equal(search('Ｔｒｕｅ  Love Song', songs, aliases).matches[0].song_id, 8);
  assert.equal(search('lov', songs, aliases).match, 'partial');
  assert.equal(search('shared', songs, aliases).total, 2);
});
test('ID conversion preserves utage and numeric aliases', () => {
  assert.equal(search('10008', songs, aliases).normalized_id, 8);
  assert.equal(search('100008', songs, aliases).matches[0].song_id, 100008);
  assert.equal(search('8', songs, [{ song_id: 9, aliases: ['8'] }]).total, 2);
});
test('missing songs, empty aliases, and no matches stay distinct', () => {
  assert.equal(search('orphan', songs, [{ song_id: 99, aliases: ['orphan'] }]).matches[0].title, null);
  assert.deepEqual(search('Party', songs, aliases).matches[0].aliases, []);
  assert.equal(search('missing', songs, aliases).total, 0);
});
test('results are bounded and truncation is explicit', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ song_id: i, aliases: Array.from({ length: 20 }, (_, j) => `alias${j}`) }));
  const result = search('alias', [], rows);
  assert.equal(result.total, 8);
  assert.equal(result.matches.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.matches[0].aliases.length, 12);
  assert.equal(result.matches[0].aliases_truncated, true);
});
test('invalid input and API errors are not no-match results', async () => {
  assert.throws(() => search(' ', songs, aliases));
  assert.throws(() => search('x', songs, [{ song_id: 1, aliases: [null] }]));
  await assert.rejects(queryRemote('x', async () => ({ ok: false, status: 429 })), /HTTP 429/);
  await assert.rejects(queryRemote('x', async () => ({ ok: true, json: async () => ({ success: false }) })), /schema/);
});
