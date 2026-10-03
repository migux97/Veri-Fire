import { config } from './config';
import { solanaLedger, stellarLedger } from './ledger';
import { singleton } from './singleton';

// While the contract or program id is empty (or the server's key is missing) warranties are stored only locally:
// demo mode. CHAIN picks the network (see chain-kind.ts).
export const chain = singleton(`ledger-${config.chain}`, () => (config.chain === 'solana' ? solanaLedger(config.solana) : stellarLedger(config.stellar)));

// A product as the ledger addresses it.
export const refOf = (product: { token: string; chain: { tokenId: number } }) => ({ tokenId: product.chain.tokenId, code: product.token });
