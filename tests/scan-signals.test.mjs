import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copySignalOf, ownersCount, scanCountry } from '../src/lib/scan-signals.ts';

test('a sealed product with ordinary checks shows no signal and no owners', () => {
  const events = [
    { kind: 'verified', at: '2026-10-01T10:00:00.000Z', country: 'AR' },
    { kind: 'verified', at: '2026-10-01T23:00:00.000Z', country: 'AR' }
  ];
  assert.equal(copySignalOf(events), null);
  assert.equal(ownersCount(false, events), 0);
});

test('an already activated product counts its buyer and flags a second activation attempt', () => {
  const events = [
    { kind: 'verified', at: '2026-10-01T10:00:00.000Z', country: 'AR' },
    { kind: 'rejected', at: '2026-10-03T12:00:00.000Z' }
  ];
  assert.equal(ownersCount(true, events), 1);
  assert.deepEqual(copySignalOf(events), { kind: 'rejected-claim', at: '2026-10-03T12:00:00.000Z' });
});

test('each transfer adds an owner', () => {
  const events = [
    { kind: 'transferred', at: '2026-10-02T10:00:00.000Z' },
    { kind: 'transferred', at: '2026-10-04T10:00:00.000Z' }
  ];
  assert.equal(ownersCount(true, events), 3);
});

test('checks from two countries within the window point to a copied public QR', () => {
  const events = [
    { kind: 'verified', at: '2026-10-01T10:00:00.000Z', country: 'AR' },
    { kind: 'verified', at: '2026-10-02T09:00:00.000Z', country: 'US' }
  ];
  assert.deepEqual(copySignalOf(events), { kind: 'distant-scans', at: '2026-10-02T09:00:00.000Z', countries: ['AR', 'US'] });
});

test('checks from two countries far apart in time are a normal export, not a copy', () => {
  const events = [
    { kind: 'verified', at: '2026-09-01T10:00:00.000Z', country: 'AR' },
    { kind: 'verified', at: '2026-10-01T10:00:00.000Z', country: 'US' }
  ];
  assert.equal(copySignalOf(events), null);
});

test('the latest signal wins', () => {
  const events = [
    { kind: 'rejected', at: '2026-10-01T08:00:00.000Z' },
    { kind: 'verified', at: '2026-10-02T10:00:00.000Z', country: 'AR' },
    { kind: 'verified', at: '2026-10-02T12:00:00.000Z', country: 'BR' }
  ];
  assert.equal(copySignalOf(events)?.kind, 'distant-scans');
});

test('only real country codes from the proxy count', () => {
  assert.equal(scanCountry('ar'), 'AR');
  assert.equal(scanCountry('XX'), null);
  assert.equal(scanCountry('T1'), null);
  assert.equal(scanCountry(''), null);
  assert.equal(scanCountry(null), null);
  assert.equal(scanCountry('ARG'), null);
});
