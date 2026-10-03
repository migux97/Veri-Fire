import type { APIRoute } from 'astro';
import { prepareClaim } from '@/lib/server/claims';
import { errorResponse, json, readJsonBody } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    rateLimit('claims', clientAddress, 20);
    return json(await prepareClaim(await readJsonBody(request, 'Claim request error:')));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo preparar la activación en la blockchain.', 'Chain prepare error:');
  }
};
