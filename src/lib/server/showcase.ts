// The products shown on the home page: the latest with their warranty activated whose owner chose to show them. Each
// one carries only its photo, model, destination, the company's name and logo and when it was verified: the owner's
// account never appears. The choice is made when activating (see claims.ts), and only its owner can undo or redo it.
import type { ShowcaseItem } from '../types';
import { HttpError } from './errors';
import { publishedIssuerOf } from './brands';
import { isCurrentOnChain, warrantyView } from './products';
import { photoOfBatch } from './photos';
import { showcaseBlockOf } from './showcase-rules';
import { saveState, store } from './store';
import { isOwnerAddress } from './chain-kind';

export const SHOWCASE_LIMIT = 12;

export const showcaseItems = (limit = SHOWCASE_LIMIT): ShowcaseItem[] =>
  [...store.products.values()]
    .flatMap((product) => {
      // Checked first: looking the photo up walks the purchases, and only the products shown need it.
      if (!product.claimed || !product.showcase || !product.claimedAt) return [];
      const photoUrl = photoOfBatch(product.batchId);
      // Only products of verified companies: a product of an unverified one must not be advertised as verified.
      if (!photoUrl || showcaseBlockOf(product.batchId)) return [];
      const issuer = publishedIssuerOf(product.batchId);
      return [{
        token: product.token,
        model: product.model,
        lot: product.lot,
        destination: product.destination,
        photoUrl,
        verifiedAt: product.claimedAt,
        issuer: issuer ? { name: issuer.name, logoUrl: issuer.logoUrl } : null,
        onChain: isCurrentOnChain(product)
      } satisfies ShowcaseItem];
    })
    .sort((first, second) => second.verifiedAt.localeCompare(first.verifiedAt))
    .slice(0, limit);

// The owner (already proven by the signature of the request) shows or hides one of its products.
export const setShowcase = (owner: string, token: unknown, visible: unknown, baseUrl: string) => {
  const product = typeof token === 'string' ? store.products.get(token.trim().toUpperCase()) : undefined;
  if (!product?.claimed || !isOwnerAddress(owner) || product.owner !== owner) throw new HttpError(404, 'No encontramos ese producto en tu cuenta.');
  if (typeof visible !== 'boolean') throw new HttpError(400, 'Indicá si querés mostrarlo o no.');
  const blocked = visible ? showcaseBlockOf(product.batchId) : null;
  if (blocked === 'photo') throw new HttpError(409, 'Este producto no tiene foto: la empresa que lo emitió todavía no la cargó.');
  if (blocked === 'unverified') throw new HttpError(409, 'La empresa que emitió este producto todavía no está verificada por Verifire, así que no puede aparecer en el inicio.');
  const before = product.showcase;
  if (visible) product.showcase ??= { at: new Date().toISOString() };
  else delete product.showcase;
  try {
    saveState();
  } catch (error) {
    if (before) product.showcase = before;
    else delete product.showcase;
    throw error;
  }
  return warrantyView(product, baseUrl);
};
