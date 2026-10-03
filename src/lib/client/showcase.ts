// The buyer's choice to show a verified product on the home page. Showing or hiding one after the activation is a change
// to the account, so the wallet signs it (see /api/showcase); the choice made while activating travels in the activation.
import type { Warranty } from '../types';
import { postJson } from './api';
import { bytesToBase64 } from './bytes';
import { connectSigner } from './signer';

export const setShowcase = async (appId: string, owner: string, token: string, visible: boolean): Promise<Warranty> => {
  const { nonce } = await postJson<{ nonce: string }>('/api/workspace/challenge', { owner }, 'No se pudo preparar la comprobación de tu wallet.');
  const wallet = await connectSigner(appId, owner);
  const { signature, publicKey } = await wallet.signMessage(nonce);
  return postJson<Warranty>(
    '/api/showcase',
    { owner, nonce, signature: bytesToBase64(signature), publicKey, token, visible },
    'No se pudo cambiar la portada.'
  );
};
