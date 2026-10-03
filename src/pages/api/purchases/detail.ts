import type { APIRoute } from 'astro';
import { publicBaseUrl } from '@/lib/server/config';
import { errorResponse, json, readJsonBody, textField } from '@/lib/server/http';
import { findPurchase, purchaseStatus } from '@/lib/server/purchases';
import { rateLimit } from '@/lib/server/rate-limit';

// The batch with the secret code of every product. The purchase id is the company's only key to them, so it travels in
// the body and not in the path: a URL ends up in access logs, in proxy logs and in the browser's history, and this id
// cannot be rotated. GET /api/purchases/:id answers the same purchase without any secret.
export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  try {
    rateLimit('purchase-detail', clientAddress, 60);
    const purchaseId = textField(await readJsonBody(request, 'Purchase detail error:'), 'purchaseId');
    const purchase = purchaseId ? findPurchase(purchaseId) : undefined;
    if (!purchase) return json({ error: 'La compra no existe.' }, 404);
    return json(await purchaseStatus(purchase, { summaryOnly: false, baseUrl: publicBaseUrl(url) }));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo consultar automáticamente el pago.', 'Solana Pay status error:');
  }
};
