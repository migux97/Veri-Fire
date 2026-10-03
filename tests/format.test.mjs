// Shared formatting: what the panels show for an address, an amount and the time left on a transfer link.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCountdown, formatNumber, plural, shortAddress } from '../src/lib/format.ts';
import { isWalletAddress, normalizeId } from '../src/lib/validation.ts';

const ADDRESS = 'F6YopjFsuhvDxUmyCPLbovkqXJ6e5DRXpuf7qRWP3Sx4';

test('a countdown never goes below zero and always shows two digits of seconds', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const inSeconds = (seconds) => new Date(now + seconds * 1000).toISOString();
  assert.equal(formatCountdown(inSeconds(245), now), '4:05');
  assert.equal(formatCountdown(inSeconds(60), now), '1:00');
  assert.equal(formatCountdown(inSeconds(0.4), now), '0:01');
  assert.equal(formatCountdown(inSeconds(-500), now), '0:00');
});

test('an address is shortened to its ends, and a missing one says so', () => {
  assert.equal(shortAddress(ADDRESS), 'F6Yo…3Sx4');
  assert.equal(shortAddress(null), 'desconocido');
  assert.equal(shortAddress(''), 'desconocido');
});

test('amounts are grouped in the Argentine way', () => {
  assert.equal(formatNumber(1234.567), '1.234,57');
  assert.equal(formatNumber(1234.567, 1), '1.234,6');
  assert.equal(formatNumber(0), '0');
});

test('plural picks the word by count', () => {
  assert.equal(plural(1, 'lote', 'lotes'), 'lote');
  assert.equal(plural(0, 'lote', 'lotes'), 'lotes');
  assert.equal(plural(2, 'lote', 'lotes'), 'lotes');
});

test('only a base58 Solana address passes as one', () => {
  assert.equal(isWalletAddress(ADDRESS), true);
  assert.equal(isWalletAddress(`${ADDRESS}XXXXXXXXXXXXX`), false);
  assert.equal(isWalletAddress(ADDRESS.slice(0, 20)), false);
  // Base58 has no 0, O, I or l.
  assert.equal(isWalletAddress(`0${ADDRESS.slice(1)}`), false);
  assert.equal(isWalletAddress(`l${ADDRESS.slice(1)}`), false);
  for (const value of [null, undefined, 7, {}, '']) assert.equal(isWalletAddress(value), false);
});

test('product codes are matched without case or stray spaces', () => {
  assert.equal(normalizeId(' vf-001 '), 'VF-001');
  assert.equal(normalizeId(null), '');
});
