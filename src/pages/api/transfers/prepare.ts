import type { APIRoute } from 'astro';
import { rateLimit } from '@/lib/server/rate-limit';
import { errorResponse, json, readJsonBody } from '@/lib/server/http';
import { prepareTransfer } from '@/lib/server/transfers';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    // Each call reads or submits to Stellar, so an address gets a budget of them.
    rateLimit('transfer-prepare', clientAddress, 30);
    return json(await prepareTransfer(await readJsonBody(request, 'Transfer request error:')));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo leer el link de transferencia.', 'Chain transfer prepare error:');
  }
};
