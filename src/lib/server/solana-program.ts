// Codificación del programa Anchor solana/programs/verifire_product: direcciones (PDA), datos de instrucciones,
// lectura de cuentas y los mensajes que firman las claves de activación y de transferencia. No toca la red, así que
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

export interface ProductArgs {
  publicCode: string;
  model: string;
  lot: string;
  destination: string;
  // Clave pública ed25519 derivada del secreto de adentro de la caja.
  activationKey: Uint8Array;
}

const productArgs = (args: ProductArgs) => {
  const codeBytes = utf8.encode(args.publicCode).length;
  if (codeBytes === 0 || codeBytes > MAX_CODE_BYTES) throw new Error(`El código público debe tener entre 1 y ${MAX_CODE_BYTES} bytes.`);
  return concat(string(args.publicCode), string(args.model), string(args.lot), string(args.destination), fixed32(args.activationKey));
};

export const instructionData = {
  initialize: (minter: Address, offerCooldownSeconds: number) =>
    concat(instructionDiscriminator('initialize'), addressBytes(minter), i64(offerCooldownSeconds)),
  updateConfig: (changes: { admin?: Address; minter?: Address; offerCooldownSeconds?: number }) => concat(
    instructionDiscriminator('update_config'),
    option(changes.admin ? addressBytes(changes.admin) : null),
    option(changes.minter ? addressBytes(changes.minter) : null),
    option(changes.offerCooldownSeconds === undefined ? null : i64(changes.offerCooldownSeconds))
  ),
  mintProduct: (args: ProductArgs) => concat(instructionDiscriminator('mint_product'), productArgs(args)),
  importClaimedProduct: (args: ProductArgs, owner: Address) =>
    concat(instructionDiscriminator('import_claimed_product'), productArgs(args), addressBytes(owner)),
  activateProduct: () => concat(instructionDiscriminator('activate_product')),
  offerTransfer: (transferKey: Uint8Array) => concat(instructionDiscriminator('offer_transfer'), fixed32(transferKey)),
  cancelTransfer: () => concat(instructionDiscriminator('cancel_transfer')),
  acceptTransfer: () => concat(instructionDiscriminator('accept_transfer'))
};

export const configAddress = async (programId: Address) =>
  (await getProgramDerivedAddress({ programAddress: programId, seeds: ['config'] }))[0];

export const productAddress = async (programId: Address, publicCode: string) =>
  (await getProgramDerivedAddress({ programAddress: programId, seeds: ['product', utf8.encode(publicCode)] }))[0];

export const programDataAddress = async (programId: Address) =>
  (await getProgramDerivedAddress({ programAddress: BPF_LOADER_UPGRADEABLE, seeds: [addressBytes(programId)] }))[0];

/** Bytes que firma una clave de activación o de transferencia: dominio || programa || producto || cuenta. */
export const signedMessage = (domain: string, programId: Address, product: Address, account: Address) =>
  concat(utf8.encode(domain), addressBytes(programId), addressBytes(product), addressBytes(account));

export const activationMessage = (programId: Address, product: Address, claimant: Address) =>
  signedMessage(ACTIVATION_DOMAIN, programId, product, claimant);

export const transferMessage = (programId: Address, product: Address, recipient: Address) =>
  signedMessage(TRANSFER_DOMAIN, programId, product, recipient);

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
  mintProduct: async (programId: Address, minter: Address, payer: Address, args: ProductArgs): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [
      writable(await configAddress(programId)), readonlySigner(minter), writable(await productAddress(programId, args.publicCode)),
      writableSigner(payer), readonly(SYSTEM_PROGRAM)
    ],
    data: instructionData.mintProduct(args)
  }),
  importClaimedProduct: async (programId: Address, admin: Address, payer: Address, args: ProductArgs, owner: Address): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [
      writable(await configAddress(programId)), readonlySigner(admin), writable(await productAddress(programId, args.publicCode)),
      writableSigner(payer), readonly(SYSTEM_PROGRAM)
    ],
    data: instructionData.importClaimedProduct(args, owner)
  }),
  activateProduct: (programId: Address, product: Address, claimant: Address): Instruction => ({
    programAddress: programId,
    accounts: [writable(product), readonlySigner(claimant), readonly(INSTRUCTIONS_SYSVAR)],
    data: instructionData.activateProduct()
  }),
  offerTransfer: async (programId: Address, product: Address, owner: Address, transferKey: Uint8Array): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [readonly(await configAddress(programId)), writable(product), readonlySigner(owner)],
    data: instructionData.offerTransfer(transferKey)
  }),
  cancelTransfer: async (programId: Address, product: Address, owner: Address): Promise<Instruction> => ({
    programAddress: programId,
    accounts: [readonly(await configAddress(programId)), writable(product), readonlySigner(owner)],
    data: instructionData.cancelTransfer()
  }),
  acceptTransfer: (programId: Address, product: Address, recipient: Address): Instruction => ({
    programAddress: programId,
    accounts: [writable(product), readonlySigner(recipient), readonly(INSTRUCTIONS_SYSVAR)],
    data: instructionData.acceptTransfer()
  })
};

export interface OnChainProduct {
  tokenId: number;
  publicCode: string;
  model: string;
  lot: string;
  destination: string;
  activationKey: Uint8Array;
  // null mientras el producto está sellado.
  owner: Address | null;
  claimed: boolean;
  // Clave pública del link de transferencia abierto, si hay uno.
  transferKey: Uint8Array | null;
  // Unix timestamp (segundos); 0 sin link.
  transferExpiresAt: number;
  lastOfferAt: number;
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

export const decodeProduct = (data: Uint8Array): OnChainProduct => {
  const reader = readerFor(data, 'Product');
  const tokenId = reader.u64();
  const publicCode = reader.string();
  const model = reader.string();
  const lot = reader.string();
  const destination = reader.string();
  const activationKey = reader.bytes32();
  const owner = reader.option(() => reader.address());
  const transferKey = reader.option(() => reader.bytes32());
  const transferExpiresAt = reader.i64();
  const lastOfferAt = reader.i64();
  return { tokenId, publicCode, model, lot, destination, activationKey, owner, claimed: owner !== null, transferKey, transferExpiresAt, lastOfferAt };
};

export const decodeConfig = (data: Uint8Array): OnChainConfig => {
  const reader = readerFor(data, 'Config');
  return { admin: reader.address(), minter: reader.address(), nextTokenId: reader.u64(), offerCooldownSeconds: reader.i64() };
};

// Errores del programa (#[error_code], 6000 + índice) con el texto que ve el usuario.
export const PROGRAM_ERRORS = [
  'NotUpgradeAuthority', 'NotAdmin', 'NotMinter', 'InvalidCode', 'InvalidField', 'InvalidCooldown', 'Overflow',
  'AlreadyClaimed', 'NotOwner', 'NoOpenTransfer', 'AlreadyOwner', 'TransferExpired', 'OfferTooSoon', 'InvalidSignature'
] as const;
export type ProgramError = (typeof PROGRAM_ERRORS)[number];
export const programErrorName = (code: number): ProgramError | null => PROGRAM_ERRORS[code - 6000] ?? null;
