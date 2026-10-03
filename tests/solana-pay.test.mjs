// Solana Pay: how a batch's USDC total becomes base units, and how a payment is recognised in a confirmed transaction.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receivedBy, toBaseUnits } from '../src/lib/server/solana.ts';

const TREASURY = 'F6YopjFsuhvDxUmyCPLbovkqXJ6e5DRXpuf7qRWP3Sx4';
const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const balance = (owner, mint, amount) => ({ owner, mint, uiTokenAmount: { amount: String(amount) } });

test('a USDC total becomes base units without rounding', () => {
  assert.equal(toBaseUnits('12.50', 6), 12_500_000n);
  assert.equal(toBaseUnits('3', 6), 3_000_000n);
  assert.equal(toBaseUnits('0.0000019', 6), 1n);
  assert.throws(() => toBaseUnits('-1', 6));
  assert.throws(() => toBaseUnits('1e3', 6));
});

test('only what the treasury received in that token counts as paid', () => {
  const meta = {
    preTokenBalances: [balance(TREASURY, USDC, 1_000_000), balance('payer', USDC, 9_000_000)],
    postTokenBalances: [balance(TREASURY, USDC, 13_500_000), balance('payer', USDC, 0)]
  };
  assert.equal(receivedBy(meta, TREASURY, USDC), 12_500_000n);
  assert.equal(receivedBy(meta, TREASURY, 'other-mint'), 0n);
  assert.equal(receivedBy(meta, 'payer', USDC), -9_000_000n);
});

test('a first payment into a new token account counts in full', () => {
  const meta = { preTokenBalances: [], postTokenBalances: [balance(TREASURY, USDC, 5_000_000)] };
  assert.equal(receivedBy(meta, TREASURY, USDC), 5_000_000n);
  assert.equal(receivedBy({ preTokenBalances: null, postTokenBalances: null }, TREASURY, USDC), 0n);
});
