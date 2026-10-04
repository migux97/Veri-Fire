// Privy's Solana wallet signs messages with Node's `Buffer`, which browsers do not have: without it every wallet proof
// (company sync, verification, showcase) fails with "Buffer is not defined". Imported first by PrivyBridge.
import { Buffer } from 'buffer';

const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
scope.Buffer ??= Buffer;
