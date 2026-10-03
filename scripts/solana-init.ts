// Initializes the VeriFire program after `anchor deploy`: creates its config with the deployer as admin (the program
// only accepts its upgrade authority here) and the server's key as minter.
// Usage: npm run solana:init -- [--cooldown 60]
//   SOLANA_ADMIN_KEYPAIR  keypair file of the upgrade authority (default ~/.config/solana/id.json)
//   SOLANA_MINTER_SECRET  the server's key (see src/lib/server/solana.ts); only its public address is used here
//   SOLANA_PROGRAM_ID, SOLANA_RPC_URL
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  address, appendTransactionMessageInstructions, compileTransaction, createSolanaRpc, createTransactionMessage, getBase58Decoder,
  getBase64EncodedWireTransaction, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, signTransaction
} from '@solana/kit';
import { keypairFromSecret } from '../src/lib/server/solana.ts';
import { configAddress, instructions } from '../src/lib/server/solana-program.ts';

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const programIdText = process.env['SOLANA_PROGRAM_ID'];
const minterSecret = process.env['SOLANA_MINTER_SECRET'];
if (!programIdText || !minterSecret) {
  console.error('Faltan SOLANA_PROGRAM_ID o SOLANA_MINTER_SECRET en .env.');
  process.exit(1);
}
const programId = address(programIdText);
const rpc = createSolanaRpc(process.env['SOLANA_RPC_URL'] || 'https://api.devnet.solana.com');
const adminFile = process.env['SOLANA_ADMIN_KEYPAIR'] || `${homedir()}/.config/solana/id.json`;
const admin = await keypairFromSecret(readFileSync(adminFile, 'utf8'));
const minter = await keypairFromSecret(minterSecret);
const cooldown = Number(option('--cooldown') ?? 60);

const config = await configAddress(programId);
if ((await rpc.getAccountInfo(config, { encoding: 'base64' }).send()).value) {
  console.log(`El programa ${programId} ya está inicializado (config ${config}).`);
  process.exit(0);
}

const initialize = await instructions.initialize(programId, admin.address, minter.address, cooldown);
const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
const message = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayer(admin.address, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(lifetime, tx),
  (tx) => appendTransactionMessageInstructions([initialize], tx)
);
const tx = await signTransaction([admin.keyPair], compileTransaction(message));
await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
console.log(`Programa inicializado. Admin ${admin.address}, minter ${minter.address}, espera entre links ${cooldown} s.`);
console.log(`Transacción: ${getBase58Decoder().decode(tx.signatures[admin.address] ?? new Uint8Array())}`);
