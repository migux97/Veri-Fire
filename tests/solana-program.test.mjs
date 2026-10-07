// The Solana encoding must match the Anchor program byte for byte: these vectors are also checked by the Rust tests
// (solana/programs/verifire_product/tests/vectors.rs), so either side changing alone fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { address } from '@solana/kit';
import {
  activationMessage, batchAddress, certificateAddress, configAddress, decodeBatch, decodeCertificate, ed25519Instruction,
  instructionData, leafHash, merkleRoot, merkleTree, programDataAddress, programErrorName, transferMessage
} from '../src/lib/server/solana-program.ts';
import { activationKeyFor, signWithSecret } from '../src/lib/server/solana-keys.ts';
import { ACTIVATION_DOMAIN } from '../src/lib/activation.ts';

const vectors = JSON.parse(readFileSync(new URL('../solana/fixtures/vectors.json', import.meta.url), 'utf8'));
const programId = address(vectors.programId);
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const bytes = (value) => Uint8Array.from(Buffer.from(value, 'hex'));
const list = (value) => value.split(',').map(bytes);
const batchArgs = {
  batchCode: vectors.batchCode,
  root: bytes(vectors.merkleRoot),
  count: 3,
  model: vectors.model,
  lot: 'L-2026-09',
  destination: 'Argentina'
};
const activationArgs = { publicCode: vectors.code, index: 2, activationKey: bytes(vectors.activationKey), proof: list(vectors.merkleProof) };

test('program addresses are derived like the program does', async () => {
  assert.equal(await configAddress(programId), vectors.configAddress);
  assert.equal(await batchAddress(programId, vectors.batchCode), vectors.batchAddress);
  assert.equal(await certificateAddress(programId, vectors.code), vectors.certificateAddress);
  assert.equal(await programDataAddress(programId), vectors.programDataAddress);
});

test('the activation key derived from the printed secret is the one the program stores', () => {
  assert.equal(activationKeyFor(vectors.secret).toString('hex'), vectors.activationKey);
});

test('a batch tree has the root and proofs the program checks', () => {
  const leaves = [
    leafHash(0, activationKeyFor('VF-SECRET-A'), 'VF-UNIT0001'),
    leafHash(1, activationKeyFor('VF-SECRET-B'), 'VF-UNIT0002'),
    leafHash(2, bytes(vectors.activationKey), vectors.code)
  ];
  assert.deepEqual(leaves.map(hex), vectors.merkleLeaves.split(','));
  const { root, proofs } = merkleTree(leaves);
  assert.equal(hex(root), vectors.merkleRoot);
  assert.deepEqual(proofs[2].map(hex), vectors.merkleProof.split(','));
  // Every leaf climbs to the same root with its own proof, whatever the size of the batch.
  for (const size of [1, 2, 5, 8, 500]) {
    const many = Array.from({ length: size }, (_, index) => leafHash(index, activationKeyFor(`VF-SECRET-${index}`), `VF-CODE${index}`));
    const tree = merkleTree(many);
    many.forEach((leaf, index) => assert.equal(hex(merkleRoot(leaf, tree.proofs[index])), hex(tree.root)));
    assert.ok(Math.max(...tree.proofs.map((proof) => proof.length)) <= Math.ceil(Math.log2(size)));
  }
  assert.notEqual(hex(merkleRoot(leafHash(1, bytes(vectors.activationKey), vectors.code), list(vectors.merkleProof))), vectors.merkleRoot);
});

test('signed messages bind the program, the certificate and the account', () => {
  const product = address(vectors.certificateAddress);
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
  assert.equal(hex(instructionData.registerBatch(batchArgs)), vectors.registerBatchData);
  assert.equal(hex(instructionData.importClaimedProduct(vectors.code, address(vectors.claimant))), vectors.importClaimedProductData);
  assert.equal(hex(instructionData.activateProduct(activationArgs)), vectors.activateProductData);
  assert.equal(hex(instructionData.offerTransfer(bytes(vectors.transferKey))), vectors.offerTransferData);
  assert.equal(hex(instructionData.cancelTransfer()), vectors.cancelTransferData);
  assert.equal(hex(instructionData.acceptTransfer()), vectors.acceptTransferData);
});

test('certificate and batch accounts are decoded field by field', () => {
  const certificate = decodeCertificate(bytes(vectors.certificateAccount));
  assert.deepEqual({ ...certificate, transferKey: hex(certificate.transferKey) }, {
    tokenId: 42,
    owner: vectors.claimant,
    transferKey: vectors.transferKey,
    transferExpiresAt: 1_800_000_900,
    lastOfferAt: 1_800_000_000
  });
  const batch = decodeBatch(bytes(vectors.batchAccount));
  assert.deepEqual({ ...batch, root: hex(batch.root) }, {
    root: vectors.merkleRoot, firstTokenId: 40, count: 3, batchCode: vectors.batchCode, model: vectors.model, lot: 'L-2026-09', destination: 'Argentina'
  });
  assert.throws(() => decodeCertificate(bytes(vectors.batchAccount)), /no es un Certificate/);
});

test('codes longer than a PDA seed are refused before reaching the network', () => {
  assert.throws(() => instructionData.activateProduct({ ...activationArgs, publicCode: 'X'.repeat(33) }), /entre 1 y 32 bytes/);
  assert.throws(() => instructionData.registerBatch({ ...batchArgs, batchCode: '' }), /entre 1 y 32 bytes/);
});

test('program error codes map to names', () => {
  assert.equal(programErrorName(6007), 'AlreadyClaimed');
  assert.equal(programErrorName(6013), 'InvalidSignature');
  assert.equal(programErrorName(6014), 'InvalidProof');
  assert.equal(programErrorName(1), null);
});
