import type { APIRoute } from 'astro';
import { errorResponse, json, readJsonBody, textField } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { issueNonce } from '@/lib/server/wallet-auth';

// Step one of reading or writing a company account: the server hands out a nonce that the browser signs with its
// Privy wallet. It says nothing about the account, so asking for one reveals nothing.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    rateLimit('workspace-challenge', clientAddress, 30);
    const owner = textField(await readJsonBody(request, 'Workspace challenge error:'), 'owner').trim();
    return json({ nonce: issueNonce(owner) });
  } catch (error) {
    return errorResponse(error, 500, 'No se pudo preparar la comprobación de tu wallet.', 'Workspace challenge error:');
  }
};
