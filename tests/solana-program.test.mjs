// The Solana encoding must match the Anchor program byte for byte: these vectors are also checked by the Rust tests
// (solana/programs/verifire_product/tests/vectors.rs), so either side changing alone fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { address } from '@solana/kit';
import {
  activationMessage, configAddress, decodeProduct, ed25519Instruction, instructionData, productAddress, programDataAddress,
  programErrorName, transferMessage
} from '../src/lib/server/solana-program.ts';
import { activationKeyFor, signWithSecret } from '../src/lib/server/solana-keys.ts';
import { ACTIVATION_DOMAIN } from '../src/lib/activation.ts';

const vectors = JSON.parse(readFileSync(new URL('../solana/fixtures/vectors.json', import.meta.url), 'utf8'));
const programId = address(vectors.programId);
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const bytes = (value) => Uint8Array.from(Buffer.from(value, 'hex'));
const args = {
  publicCode: vectors.code,
  model: vectors.model,
  lot: 'L-2026-09',
  destination: 'Argentina',
  activationKey: bytes(vectors.activationKey)
};

test('program addresses are derived like the program does', async () => {
  assert.equal(await configAddress(programId), vectors.configAddress);
  assert.equal(await productAddress(programId, vectors.code), vectors.productAddress);
  assert.equal(await programDataAddress(programId), vectors.programDataAddress);
});

test('the activation key derived from the printed secret is the one the program stores', () => {
  assert.equal(activationKeyFor(vectors.secret).toString('hex'), vectors.activationKey);
});

test('signed messages bind the program, the product and the account', () => {
  const product = address(vectors.productAddress);
  const claimant = address(vectors.claimant);
  assert.equal(hex(activationMessage(programId, product, claimant)), vectors.activationMessage);
  assert.equal(hex(transferMessage(programId, product, claimant)), vectors.transferMessage);
});

test('a signature made from the secret is the one the browser would make', () => {
  const message = bytes(vectors.activationMessage);
  assert.equal(hex(signWithSecret(ACTIVATION_DOMAIN, vectors.secret, message)), vectors.activationSignature);
});

test('the ed25519 verify instruction has the native program layout', () => {
  const instruction = ed25519Instruction(bytes(vectors.activationKey), bytes(vectors.activationSignature), bytes(vectors.activationMessage));
  assert.equal(instruction.programAddress, 'Ed25519SigVerify111111111111111111111111111');
  assert.equal(hex(instruction.data), vectors.ed25519Data);
});

test('instruction data matches the Anchor encoding', () => {
  const minter = address(vectors.minter);
  assert.equal(hex(instructionData.initialize(minter, 60)), vectors.initializeData);
  assert.equal(hex(instructionData.updateConfig({ minter, offerCooldownSeconds: 30 })), vectors.updateConfigData);
  assert.equal(hex(instructionData.mintProduct(args)), vectors.mintProductData);
  assert.equal(hex(instructionData.importClaimedProduct(args, address(vectors.claimant))), vectors.importClaimedProductData);
  assert.equal(hex(instructionData.activateProduct()), vectors.activateProductData);
  assert.equal(hex(instructionData.offerTransfer(bytes(vectors.transferKey))), vectors.offerTransferData);
  assert.equal(hex(instructionData.cancelTransfer()), vectors.cancelTransferData);
  assert.equal(hex(instructionData.acceptTransfer()), vectors.acceptTransferData);
});

test('a product account is decoded field by field', () => {
  const product = decodeProduct(bytes(vectors.productAccount));
  assert.deepEqual({ ...product, activationKey: hex(product.activationKey), transferKey: hex(product.transferKey) }, {
    tokenId: 42,
    publicCode: vectors.code,
    model: vectors.model,
    lot: 'L-2026-09',
    destination: 'Argentina',
    activationKey: vectors.activationKey,
    owner: vectors.claimant,
    claimed: true,
    transferKey: vectors.transferKey,
    transferExpiresAt: 1_800_000_900,
    lastOfferAt: 1_800_000_000
  });
  assert.throws(() => decodeProduct(bytes(vectors.mintProductData)), /no es un Product/);
});

test('codes longer than a PDA seed are refused before reaching the network', () => {
  assert.throws(() => instructionData.mintProduct({ ...args, publicCode: 'X'.repeat(33) }), /entre 1 y 32 bytes/);
});

test('program error codes map to names', () => {
  assert.equal(programErrorName(6007), 'AlreadyClaimed');
  assert.equal(programErrorName(6013), 'InvalidSignature');
  assert.equal(programErrorName(1), null);
});
