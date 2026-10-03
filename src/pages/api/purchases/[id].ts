import type { APIRoute } from 'astro';
import { publicBaseUrl } from '@/lib/server/config';
import { errorResponse, json } from '@/lib/server/http';
import { findPurchase, purchaseStatus } from '@/lib/server/purchases';
import { rateLimit } from '@/lib/server/rate-limit';

// Checks the payment and returns the summary of the purchase: how it is going, how many tokens it has and how many
// were activated. The secret codes are answered only by POST /api/purchases/detail, so they never travel in a URL.
// Each check asks Solana's RPC, so an address gets a budget: the list of batches polls pending purchases every few
// seconds and every batch once a minute, which stays well inside it.
export const GET: APIRoute = async ({ params, url, clientAddress }) => {
  try {
    rateLimit('purchase-status', clientAddress, 240);
    const purchase = params.id ? findPurchase(params.id) : undefined;
    if (!purchase) return json({ error: 'La compra no existe.' }, 404);
    return json(await purchaseStatus(purchase, { summaryOnly: true, baseUrl: publicBaseUrl(url) }));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo consultar automáticamente el pago.', 'Solana Pay status error:');
  }
};
