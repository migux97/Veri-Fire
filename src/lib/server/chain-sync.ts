// The contract is the source of truth for who owns a product. A transaction can be accepted by the network after this
// server stopped waiting for it, or while it was restarting: then the product is activated (or transferred) on-chain
// and still free here, the buyer cannot retry — the contract rejects a second activation — and the previous owner can
// still open transfer links that no longer work. Reading the contract back before acting repairs that.
import { chain, refOf } from './chain';
import { isCurrentOnChain, recordEvent } from './products';
import { saveState, type Product } from './store';
import { monthsAtActivation } from './support';

export const reconcileProduct = async (product: Product): Promise<Product> => {
  if (!chain.enabled || !isCurrentOnChain(product)) return product;
  let onChain;
  try {
    onChain = await chain.readProduct(refOf(product));
  } catch (error) {
    // The contract could not be read: what is stored here is all this request has.
    console.error(`No se pudo leer ${product.token} del contrato:`, error);
    return product;
  }
  const owner = onChain.owner;
  if (!onChain.claimed || !chain.isAddress(owner) || (product.claimed && product.owner === owner)) return product;

  const at = new Date().toISOString();
  if (!product.claimed) {
    // Activated on-chain and never saved here. The transaction hash is unknown, so the warranty shows no certificate
    // link until the product's history is read again; everything else is the same as a claim completed normally.
    Object.assign(product, { claimed: true, owner, claimedAt: at, warrantyMonths: monthsAtActivation(product) });
    console.warn(`${product.token} estaba activado en el contrato y no acá: se tomó el estado del contrato.`);
    saveState();
    return product;
  }
  // Transferred on-chain and never saved here: the new owner is the one the contract names.
  const from = product.owner ?? undefined;
  product.owner = owner;
  delete product.transfer;
  delete product.showcase;
  recordEvent(product, { kind: 'transferred', at, ...(from ? { from } : {}), to: owner });
  console.warn(`${product.token} había cambiado de dueño en el contrato: se tomó el estado del contrato.`);
  return product;
};
