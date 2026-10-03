import type { APIRoute } from 'astro';
import { rateLimit } from '@/lib/server/rate-limit';
import { buildClaimTransaction } from '@/lib/server/claims';
import { errorResponse, json, readJsonBody } from '@/lib/server/http';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    // Each call reads or submits to Stellar, so an address gets a budget of them.
    rateLimit('claim-transaction', clientAddress, 30);
    return json(await buildClaimTransaction(await readJsonBody(request, 'Claim request error:')));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo preparar la transacción de activación.', 'Chain build error:');
  }
};
