import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMpd } from '../moode';

test('parseMpd reads key: value lines and ignores OK', () => {
  const out = parseMpd('volume: 0\nstate: play\nfile: http://x/y: z\nOK\n');
  assert.equal(out.state, 'play');
  assert.equal(out.file, 'http://x/y: z');
  assert.equal(out.ok, undefined);
});

test('parseMpd on empty input gives an empty object', () => {
  assert.deepEqual(parseMpd(''), {});
});
