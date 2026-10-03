import type { APIRoute } from 'astro';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { createBatchPayment, paymentsConfigured } from '@/lib/server/purchases';
import { rateLimit } from '@/lib/server/rate-limit';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!paymentsConfigured()) {
    return json({ error: 'Configura SOLANA_PAY_RECIPIENT (y USDC_MINT si tu cluster no tiene USDC) para cobrar los lotes.' }, 503);
  }
  try {
    rateLimit('purchases', clientAddress, 10);
    return json(await createBatchPayment(await readJson(request)), 201);
  } catch (error) {
    return errorResponse(error, 502, 'No se pudo crear el pago de la emisión.', 'Solana Pay batch payment error:');
  }
};
