import type { APIRoute } from 'astro';
import { claimDemoWarranty, submitOnChainClaim, warrantiesOf } from '@/lib/server/claims';
import { publicBaseUrl } from '@/lib/server/config';
import { errorResponse, json, readJsonBody } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const GET: APIRoute = ({ url, clientAddress }) => {
  try {
    // Anyone can ask for any address: this keeps one caller from walking through addresses, and from making the
    // server walk the whole store on every request.
    rateLimit('warranties', clientAddress, 60);
    return json(warrantiesOf(url.searchParams.get('owner') ?? '', publicBaseUrl(url)));
  } catch (error) {
    return errorResponse(error, 500, 'No se pudieron cargar las garantías.', 'List warranties error:');
  }
};

// Claim from the buyer's panel. With signedXdr it is the last on-chain step; otherwise it is the demo claim.
export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  try {
    // Each attempt may hash every product, call Stellar or write the store (a rejected claim is recorded).
    rateLimit('claims-submit', clientAddress, 20);
    const body = await readJsonBody(request, 'Claim request error:');
    const baseUrl = publicBaseUrl(url);
    return json(body['signedTx'] || body['signedXdr'] ? await submitOnChainClaim(body, baseUrl) : claimDemoWarranty(body, baseUrl));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo registrar la activación en la blockchain.', 'Chain claim error:');
  }
};
