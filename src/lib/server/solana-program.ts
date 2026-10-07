// Codificación del programa Anchor solana/programs/verifire_product: direcciones (PDA), datos de instrucciones,
// lectura de cuentas, el árbol de Merkle de cada lote y los mensajes que firman las claves de activación y de transferencia. No toca la red, así que
// lo usan el servidor, los scripts y los tests. Los vectores de solana/fixtures/vectors.json, que también comprueban
// los tests en Rust, garantizan que ambos lados codifican igual.
import { createHash } from 'node:crypto';
import {
  AccountRole, address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress,
  type Address, type Instruction
} from '@solana/kit';
import { ACTIVATION_DOMAIN, TRANSFER_DOMAIN } from '../activation.ts';

export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
export const ED25519_PROGRAM = address('Ed25519SigVerify111111111111111111111111111');
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
export const BPF_LOADER_UPGRADEABLE = address('BPFLoaderUpgradeab1e11111111111111111111111');
// Debe coincidir con TRANSFER_LINK_SECONDS del programa y TRANSFER_LINK_MS en products.ts.
export const TRANSFER_LINK_SECONDS = 15 * 60;
export const MAX_CODE_BYTES = 32;

const utf8 = new TextEncoder();
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const addressBytes = (value: Address) => new Uint8Array(addressEncoder.encode(value));

const sha256 = (text: string) => createHash('sha256').update(text).digest();
// Anchor: los primeros 8 bytes de sha256("global:<instrucción>") y de sha256("account:<Cuenta>").
const instructionDiscriminator = (name: string) => sha256(`global:${name}`).subarray(0, 8);
const accountDiscriminator = (name: string) => sha256(`account:${name}`).subarray(0, 8);

// Borsh mínimo: lo justo para los tipos del programa.
const concat = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const i64 = (value: number | bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return bytes;
};
const string = (value: string) => {
  const bytes = utf8.encode(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return concat(length, bytes);
};
const fixed32 = (value: Uint8Array) => {
  if (value.length !== 32) throw new Error('Se esperaban 32 bytes.');
  return value;
};
const option = (value: Uint8Array | null | undefined) => (value ? concat(Uint8Array.of(1), value) : Uint8Array.of(0));

const vec32 = (items: readonly Uint8Array[]) => concat(u32(items.length), ...items.map(fixed32));

const code = (value: string) => {
  const length = utf8.encode(value).length;
  if (length === 0 || length > MAX_CODE_BYTES) throw new Error(`El código público debe tener entre 1 y ${MAX_CODE_BYTES} bytes.`);
  return string(value);
};

export interface BatchArgs {
  batchCode: string;
  // Raíz del árbol de hojas leafHash(índice, clave de activación, código) de las unidades del lote (ver merkleTree).
  root: Uint8Array;
  count: number;
  model: string;
  lot: string;
  destination: string;
}

export interface ActivationArgs {
  publicCode: string;
  // Posición de la unidad en su lote: fija su token id.
  index: number;
  // Clave pública ed25519 derivada del secreto de adentro de la caja.
  activationKey: Uint8Array;
  proof: readonly Uint8Array[];
}

export const instructionData = {
  initialize: (minter: Address, offerCooldownSeconds: number) =>
    concat(instructionDiscriminator('initialize'), addressBytes(minter), i64(offerCooldownSeconds)),
  updateConfig: (changes: { admin?: Address; minter?: Address; offerCooldownSeconds?: number }) => concat(
    instructionDiscriminator('update_config'),
    option(changes.admin ? addressBytes(changes.admin) : null),
    option(changes.minter ? addressBytes(changes.minter) : null),
    option(changes.offerCooldownSeconds === undefined ? null : i64(changes.offerCooldownSeconds))
  ),
  registerBatch: (args: BatchArgs) => concat(
    instructionDiscriminator('register_batch'), code(args.batchCode), fixed32(args.root), u32(args.count),
    string(args.model), string(args.lot), string(args.destination)
  ),
  importClaimedProduct: (publicCode: string, owner: Address) =>
    concat(instructionDiscriminator('import_claimed_product'), code(publicCode), addressBytes(owner)),
  activateProduct: (args: ActivationArgs) => concat(
    instructionDiscriminator('activate_product'), code(args.publicCode), u32(args.index), fixed32(args.activationKey), vec32(args.proof)
  ),
  offerTransfer: (transferKey: Uint8Array) => concat(instructionDiscriminator('offer_transfer'), fixed32(transferKey)),
  cancelTransfer: () => concat(instructionDiscriminator('cancel_transfer')),
  acceptTransfer: () => concat(instructionDiscriminator('accept_transfer'))
};

export const configAddress = async (programId: Address) =>
  (await getProgramDerivedAddress({ programAddress: programId, seeds: ['config'] }))[0];

export const batchAddress = async (programId: Address, batchCode: string) =>
  (await getProgramDerivedAddress({ programAddress: programId, seeds: ['batch', utf8.encode(batchCode)] }))[0];

// El certificado de un producto: existe solo desde que se activa.
export const certificateAddress = async (programId: Address, publicCode: string) =>
  (await getProgramDerivedAddress({ programAddress: programId, seeds: ['certificate', utf8.encode(publicCode)] }))[0];

export const programDataAddress = async (programId: Address) =>
  (await getProgramDerivedAddress({ programAddress: BPF_LOADER_UPGRADEABLE, seeds: [addressBytes(programId)] }))[0];

// Árbol de Merkle de un lote, igual que leaf_hash, node_hash y merkle_root del programa.
const hashParts = (...parts: Uint8Array[]) => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
};

/** sha256(0x00 || índice u32 LE || clave de activación || código público). */
export const leafHash = (index: number, activationKey: Uint8Array, publicCode: string) =>
  hashParts(Uint8Array.of(0), u32(index), fixed32(activationKey), utf8.encode(publicCode));

/** sha256(0x01 || menor || mayor): los pares van ordenados, así la prueba no necesita posiciones. */
export const nodeHash = (a: Uint8Array, b: Uint8Array) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? hashParts(Uint8Array.of(1), a, b) : hashParts(Uint8Array.of(1), b, a);

export const merkleRoot = (leaf: Uint8Array, proof: readonly Uint8Array[]) => proof.reduce(nodeHash, leaf);

/** Raíz y prueba de cada hoja. En un nivel impar el último nodo sube sin pareja. */
export const merkleTree = (leaves: readonly Uint8Array[]) => {
  if (leaves.length === 0) throw new Error('Un lote necesita al menos una unidad.');
  const proofs: Uint8Array[][] = leaves.map(() => []);
  const positions = leaves.map((_, index) => index);
  let level = [...leaves];
  while (level.length > 1) {
    positions.forEach((position, leaf) => {
      const sibling = level[position ^ 1];
      if (sibling) proofs[leaf]!.push(sibling);
      positions[leaf] = position >> 1;
    });
    const next: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const right = level[index + 1];
      next.push(right ? nodeHash(level[index]!, right) : level[index]!);
    }
    level = next;
  }
  return { root: level[0]!, proofs };
};

/** Bytes que firma una clave de activación o de transferencia: dominio || programa || certificado || cuenta. */
export const signedMessage = (domain: string, programId: Address, certificate: Address, account: Address) =>
  concat(utf8.encode(domain), addressBytes(programId), addressBytes(certificate), addressBytes(account));

export const activationMessage = (programId: Address, certificate: Address, claimant: Address) =>
  signedMessage(ACTIVATION_DOMAIN, programId, certificate, claimant);

export const transferMessage = (programId: Address, certificate: Address, recipient: Address) =>
  signedMessage(TRANSFER_DOMAIN, programId, certificate, recipient);

/**
 * Instrucción del programa nativo Ed25519SigVerify con una firma y todos los datos adentro (mismo formato que
 * new_ed25519_instruction_with_signature). Va inmediatamente antes de activate_product o accept_transfer.
 */
export const ed25519Instruction = (publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Instruction => {
  if (publicKey.length !== 32 || signature.length !== 64) throw new Error('Clave o firma ed25519 inválida.');
  const headerSize = 2 + 14;
  const publicKeyOffset = headerSize;
  const signatureOffset = publicKeyOffset + 32;
  const messageOffset = signatureOffset + 64;
  const header = Buffer.alloc(headerSize);
  header.writeUInt8(1, 0);
  header.writeUInt16LE(signatureOffset, 2);
  header.writeUInt16LE(0xffff, 4);
  header.writeUInt16LE(publicKeyOffset, 6);
  header.writeUInt16LE(0xffff, 8);
  header.writeUInt16LE(messageOffset, 10);
  header.writeUInt16LE(message.length, 12);
  header.writeUInt16LE(0xffff, 14);
  return { programAddress: ED25519_PROGRAM, accounts: [], data: concat(header, publicKey, signature, message) };
};

const writableSigner = (value: Address) => ({ address: value, role: AccountRole.WRITABLE_SIGNER });
const readonlySigner = (value: Address) => ({ address: value, role: AccountRole.READONLY_SIGNER });
const writable = (value: Address) => ({ address: value, role: AccountRole.WRITABLE });
const readonly = (value: Address) => ({ address: value, role: AccountRole.READONLY });

// El orden de las cuentas es el de cada struct #[derive(Accounts)] del programa.
export const instructions = {
  initialize: async (programId: Address, admin: Address, minter: Address, offerCooldownSeconds: number): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [writable(await configAddress(programId)), writableSigner(admin), readonly(await programDataAddress(programId)), readonly(SYSTEM_PROGRAM)],
    data: instructionData.initialize(minter, offerCooldownSeconds)
  }),
  updateConfig: async (programId: Address, admin: Address, changes: Parameters<typeof instructionData.updateConfig>[0]): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [writable(await configAddress(programId)), readonlySigner(admin)],
    data: instructionData.updateConfig(changes)
  }),
  registerBatch: async (programId: Address, minter: Address, payer: Address, args: BatchArgs): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [
      writable(await configAddress(programId)), readonlySigner(minter), writable(await batchAddress(programId, args.batchCode)),
      writableSigner(payer), readonly(SYSTEM_PROGRAM)
    ],
    data: instructionData.registerBatch(args)
  }),
  importClaimedProduct: async (programId: Address, admin: Address, payer: Address, publicCode: string, owner: Address): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [
      writable(await configAddress(programId)), readonlySigner(admin), writable(await certificateAddress(programId, publicCode)),
      writableSigner(payer), readonly(SYSTEM_PROGRAM)
    ],
    data: instructionData.importClaimedProduct(publicCode, owner)
  }),
  // payer paga el rent del certificado: es el servidor, que también paga la comisión.
  activateProduct: async (programId: Address, batch: Address, claimant: Address, payer: Address, args: ActivationArgs): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [
      readonly(batch), writable(await certificateAddress(programId, args.publicCode)), readonlySigner(claimant), writableSigner(payer),
      readonly(INSTRUCTIONS_SYSVAR), readonly(SYSTEM_PROGRAM)
    ],
    data: instructionData.activateProduct(args)
  }),
  offerTransfer: async (programId: Address, certificate: Address, owner: Address, transferKey: Uint8Array): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [readonly(await configAddress(programId)), writable(certificate), readonlySigner(owner)],
    data: instructionData.offerTransfer(transferKey)
  }),
  cancelTransfer: async (programId: Address, certificate: Address, owner: Address): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [readonly(await configAddress(programId)), writable(certificate), readonlySigner(owner)],
    data: instructionData.cancelTransfer()
  }),
  acceptTransfer: (programId: Address, certificate: Address, recipient: Address): Instruction => ({
    programAddress: programId,
    accounts: [writable(certificate), readonlySigner(recipient), readonly(INSTRUCTIONS_SYSVAR)],
    data: instructionData.acceptTransfer()
  })
};

// Un producto activado. Mientras está sellado no tiene certificado.
export interface OnChainCertificate {
  tokenId: number;
  owner: Address;
  // Clave pública del link de transferencia abierto, si hay uno.
  transferKey: Uint8Array | null;
  // Unix timestamp (segundos); 0 sin link.
  transferExpiresAt: number;
  lastOfferAt: number;
}

export interface OnChainBatch {
  root: Uint8Array;
  firstTokenId: number;
  count: number;
  batchCode: string;
  model: string;
  lot: string;
  destination: string;
}

export interface OnChainConfig {
  admin: Address;
  minter: Address;
  nextTokenId: number;
  offerCooldownSeconds: number;
}

class Reader {
  data: Buffer;
  offset: number;
  constructor(data: Buffer, start: number) {
    this.data = data;
    this.offset = start;
  }
  take(length: number) {
    if (this.offset + length > this.data.length) throw new Error('Cuenta del programa con datos incompletos.');
    const bytes = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }
  u8() { return this.take(1)[0] ?? 0; }
  u32() { return this.take(4).readUInt32LE(); }
  u64() { return Number(this.take(8).readBigUInt64LE()); }
  i64() { return Number(this.take(8).readBigInt64LE()); }
  string() { return this.take(this.take(4).readUInt32LE()).toString('utf8'); }
  bytes32() { return new Uint8Array(this.take(32)); }
  address() { return addressDecoder.decode(this.take(32)); }
  option<T>(read: () => T): T | null { return this.u8() === 1 ? read() : null; }
}

const readerFor = (data: Uint8Array, account: string) => {
  const buffer = Buffer.from(data);
  if (!buffer.subarray(0, 8).equals(accountDiscriminator(account))) throw new Error(`La cuenta no es un ${account} de VeriFire.`);
  return new Reader(buffer, 8);
};

export const decodeCertificate = (data: Uint8Array): OnChainCertificate => {
  const reader = readerFor(data, 'Certificate');
  const tokenId = reader.u64();
  const owner = reader.address();
  const transferKey = reader.option(() => reader.bytes32());
  const transferExpiresAt = reader.i64();
  const lastOfferAt = reader.i64();
  return { tokenId, owner, transferKey, transferExpiresAt, lastOfferAt };
};

export const decodeBatch = (data: Uint8Array): OnChainBatch => {
  const reader = readerFor(data, 'Batch');
  const root = reader.bytes32();
  const firstTokenId = reader.u64();
  const count = reader.u32();
  reader.u8();
  return { root, firstTokenId, count, batchCode: reader.string(), model: reader.string(), lot: reader.string(), destination: reader.string() };
};

export const decodeConfig = (data: Uint8Array): OnChainConfig => {
  const reader = readerFor(data, 'Config');
  return { admin: reader.address(), minter: reader.address(), nextTokenId: reader.u64(), offerCooldownSeconds: reader.i64() };
};

// Errores del programa (#[error_code], 6000 + índice) con el texto que ve el usuario.
export const PROGRAM_ERRORS = [
  'NotUpgradeAuthority', 'NotAdmin', 'NotMinter', 'InvalidCode', 'InvalidField', 'InvalidCooldown', 'Overflow',
  'AlreadyClaimed', 'NotOwner', 'NoOpenTransfer', 'AlreadyOwner', 'TransferExpired', 'OfferTooSoon', 'InvalidSignature',
  'InvalidProof', 'InvalidBatch'
] as const;
export type ProgramError = (typeof PROGRAM_ERRORS)[number];
export const programErrorName = (code: number): ProgramError | null => PROGRAM_ERRORS[code - 6000] ?? null;
