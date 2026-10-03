import type { APIRoute } from 'astro';
import { publicBaseUrl } from '@/lib/server/config';
import { errorResponse, json, readJsonBody } from '@/lib/server/http';
import { findPurchase, payFromWallet } from '@/lib/server/purchases';
import { rateLimit } from '@/lib/server/rate-limit';

// The company pays from its wallet: without signedTx it answers the payment transaction to sign, with it sends it and
// issues the batch (see purchases.ts).
export const POST: APIRoute = async ({ params, request, url, clientAddress }) => {
  try {
    rateLimit('purchase-paid', clientAddress, 20);
    const purchase = params.id ? findPurchase(params.id) : undefined;
    if (!purchase) return json({ error: 'La compra no existe.' }, 404);
    const body = await readJsonBody(request, 'Wallet payment request error:');
    return json(await payFromWallet(purchase, body, publicBaseUrl(url)));
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo completar el pago en Solana.', 'Solana Pay wallet payment error:');
  }
};
