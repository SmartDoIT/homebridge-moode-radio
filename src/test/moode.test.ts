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

import { homeName } from '../names';

test('homeName cleans names for HomeKit', () => {
  assert.equal(homeName('FluxFM - 80s'), 'FluxFM 80s');
  assert.equal(homeName('Vladix 4 (Domaći rok)'), 'Vladix 4 Domaći rok');
  assert.equal(homeName('Naxi Ex-YU'), 'Naxi Ex YU');
  assert.equal(homeName('Daško&Mlađa'), 'Daško Mlađa');
  assert.equal(homeName("--"), 'Radio');
});
