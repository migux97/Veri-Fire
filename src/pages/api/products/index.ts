import type { APIRoute } from 'astro';
import { publicBaseUrl } from '@/lib/server/config';
import { errorResponse, isAdminRequest, json, readJson } from '@/lib/server/http';
import { anchorPendingProducts, mintedProductView, mintProduct, readProductFields } from '@/lib/server/products';
import { saveState } from '@/lib/server/store';

// Mints a single product outside of a batch purchase. Only with ADMIN_API_TOKEN.
export const POST: APIRoute = async ({ request, url }) => {
  if (!isAdminRequest(request)) {
    return json({ error: 'No autorizado. Los productos se emiten comprando un lote con Solana Pay.' }, 401);
  }
  try {
    const fields = readProductFields(await readJson(request));
    if (!fields) return json({ error: 'Indica modelo, lote y destino con valores válidos.' }, 400);
    const product = mintProduct(fields);
    saveState();
    anchorPendingProducts();
    return json(mintedProductView(product, publicBaseUrl(url)), 201);
  } catch (error) {
    return errorResponse(error, 500, 'No se pudo crear el producto.', 'Create product error:');
  }
};
