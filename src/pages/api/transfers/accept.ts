import type { APIRoute } from 'astro';
import { rateLimit } from '@/lib/server/rate-limit';
import { publicBaseUrl } from '@/lib/server/config';
import { errorResponse, json, readJsonBody } from '@/lib/server/http';
import { acceptTransfer } from '@/lib/server/transfers';

// Without signedXdr it answers the transaction for the user's wallet; with it, submits it (see transfers.ts).
export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  try {
    // Each call reads or submits to Stellar, so an address gets a budget of them.
    rateLimit('transfers', clientAddress, 30);
    return json(await acceptTransfer(await readJsonBody(request, 'Transfer request error:'), publicBaseUrl(url)));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo completar la transferencia.', 'Chain transfer error:');
  }
};
