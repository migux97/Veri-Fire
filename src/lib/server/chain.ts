import { config } from './config';
import { solanaLedger } from './ledger';
import { singleton } from './singleton';

// While the program id is empty (or the server's key is missing) warranties are stored only locally: demo mode.
export const chain = singleton('ledger', () => solanaLedger(config.solana));

// A product as the program addresses it: by its public code (the PDA seed); the token id is its serial number.
export const refOf = (product: { token: string; chain: { tokenId: number } }) => ({ tokenId: product.chain.tokenId, code: product.token });
