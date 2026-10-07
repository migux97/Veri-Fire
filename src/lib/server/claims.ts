// Warranty claims.
// On-chain (see ledger.ts), in three steps, and the secret never reaches the server: the product is found by its activation key.
// 1. prepareClaim: the browser derives the activation key from the QR and gets the message to sign with it.
// 2. buildClaimTransaction: with that signature the server builds the activation; the buyer's wallet authorizes it.
// 3. submitOnChainClaim with signedTx: the server pays and submits it, and the claim is saved
//    with its transaction.
// Without a contract (demo mode) the secret read from the QR identifies the product and the claim stays in this server.
import { randomUUID } from 'node:crypto';
import type { ClaimPreview, PreparedClaim, UnsignedTransaction, Warranty } from '../types';
import { normalizeId } from '../validation';
import { chain, refOf } from './chain';
import { reconcileProduct } from './chain-sync';
import { HttpError } from './errors';
import { textField, type JsonBody } from './http';
import { secretFromQrKey } from './links';
import { photoOfBatch } from './photos';
import { showcaseBlockOf } from './showcase-rules';
import { activationKeyOf, anchorPendingProducts, isCurrentOnChain, recordRejectedClaim, transferredBy, unitInBatch, warrantyView } from './products';
import { messages } from './messages';
import { singleton } from './singleton';
import { hashSecret, saveState, store, type Product } from './store';
import { monthsAtActivation } from './support';


// Keeps a second request for the same product from submitting a duplicate transaction.
const claimsInFlight = singleton('claims-in-flight', () => new Set<string>());

// Throws when the product cannot be claimed by this owner. Another account holding the secret of a product that
// already has an owner is kept in the product's history: its label may have been copied.
const assertClaimable = (product: Product, owner: string) => {
  if (product.claimed) {
    if (product.owner === owner) throw new HttpError(409, 'Esta garantía ya está activada a tu nombre.');
    if (chain.isAddress(owner)) recordRejectedClaim(product, owner);
    throw new HttpError(409, messages.alreadyClaimed);
  }
  if (!chain.isAddress(owner)) throw new HttpError(400, messages.invalidOwner);
};

// Whether the buyer asked, when activating, to show the product on the home page. It counts only for a product that can
// be shown (a photo of its batch and a verified issuer, see showcase-rules.ts), whatever the request says.
const wantsShowcase = (body: JsonBody, product: Product) => body['showcase'] === true && showcaseBlockOf(product.batchId) === null;

// Runs synchronously after the request body was read, so two concurrent claims cannot both pass the check.
const completeClaim = (product: Product, owner: string, baseUrl: string, showcase: boolean, claimTransaction = `demo-${randomUUID()}`): Warranty => {
  assertClaimable(product, owner);
  const before = { claimed: product.claimed, owner: product.owner };
  const claimedAt = new Date().toISOString();
  Object.assign(product, { claimed: true, owner, claimedAt, warrantyMonths: monthsAtActivation(product), claimTransaction });
  if (showcase) product.showcase = { at: claimedAt };
  try {
    saveState();
  } catch (error) {
    // Back to unclaimed in memory too: otherwise a retry would answer "ya activada" for a claim the file never kept.
    Object.assign(product, before);
    delete product.claimedAt;
    delete product.warrantyMonths;
    delete product.claimTransaction;
    delete product.showcase;
    throw error;
  }
  return warrantyView(product, baseUrl);
};

// Checks shared by the three on-chain steps.
const onChainClaim = async (body: JsonBody) => {
  if (!chain.enabled) throw new HttpError(409, `La activación en Solana no está configurada en este servidor.`);
  const key = textField(body, 'activationKey').toLowerCase();
  const found = /^[0-9a-f]{64}$/.test(key) ? [...store.products.values()].find((candidate) => activationKeyOf(candidate) === key) : undefined;
  if (!found) throw new HttpError(404, messages.qrNotFound);
  // An activation that landed after this server stopped waiting for it is adopted here, so the buyer sees the
  // warranty instead of "ya fue reclamado en Solana" with no way out. Not while this server is submitting one for the
  // product: the contract already shows it, and adopting it then made the submission itself fail as "ya activada".
  const product = claimsInFlight.has(found.token) ? found : await reconcileProduct(found);
  const owner = textField(body, 'owner').trim();
  assertClaimable(product, owner);
  if (!isCurrentOnChain(product)) {
    anchorPendingProducts();
    throw new HttpError(409, `Este producto todavía se está registrando en Solana. Probá de nuevo en unos minutos.`, { retryable: true });
  }
  return { product, owner, ref: refOf(product), unit: unitInBatch(product) };
};

export const prepareClaim = async (body: JsonBody): Promise<PreparedClaim> => {
  // Without a contract the browser falls back to the demo claim.
  if (!chain.enabled) return { onChain: false };
  const { ref, owner } = await onChainClaim(body);
  const message = await chain.activationMessage(ref, owner);
  return { onChain: true, message: message.toString('base64') };
};

// The transaction the user's wallet signed, as the browser sends it.
export const signedTxOf = (body: JsonBody) => textField(body, 'signedTx');

export const unsigned = (tx: string): UnsignedTransaction => ({ tx });

export const buildClaimTransaction = async (body: JsonBody) => {
  const { ref, unit, owner } = await onChainClaim(body);
  const signature = Buffer.from(textField(body, 'signature'), 'base64');
  if (signature.length !== 64) throw new HttpError(400, 'La firma del QR no es válida.');
  return unsigned(await chain.buildActivation({ ref, unit, claimant: owner, signature }));
};

export const submitOnChainClaim = async (body: JsonBody, baseUrl: string) => {
  const { product, owner, ref, unit } = await onChainClaim(body);
  if (claimsInFlight.has(product.token)) {
    throw new HttpError(409, `La activación de este producto ya se está registrando en Solana.`, { retryable: true });
  }
  claimsInFlight.add(product.token);
  try {
    const txHash = await chain.submitActivation({ ref, unit, claimant: owner, signedTx: signedTxOf(body) });
    // Adopted meanwhile by another path that reads the contract (a transfer check): it only lacks its transaction.
    if (product.claimed && product.owner === owner) {
      const showcase = wantsShowcase(body, product) && !product.showcase;
      if (!product.claimTransaction) product.claimTransaction = txHash;
      if (showcase) product.showcase = { at: product.claimedAt ?? new Date().toISOString() };
      if (showcase || product.claimTransaction === txHash) saveState();
      return warrantyView(product, baseUrl);
    }
    return completeClaim(product, owner, baseUrl, wantsShowcase(body, product), txHash);
  } finally {
    claimsInFlight.delete(product.token);
  }
};

// Demo claim: current QR links send the opaque key; labels printed before send the code itself.
export const claimDemoWarranty = (body: JsonBody, baseUrl: string) => {
  const qr = textField(body, 'qr');
  const secret = normalizeId(qr ? secretFromQrKey(qr) : textField(body, 'secret'));
  const product = secret ? [...store.products.values()].find((candidate) => candidate.secretHash === hashSecret(secret)) : undefined;
  if (!product) throw new HttpError(404, messages.qrNotFound);
  // Products with a secret code are activated in the contract once it is configured, never only locally.
  // Already claimed ones fall through, so completeClaim answers "ya fue reclamado".
  if (chain.enabled && product.secretCode && !product.claimed) {
    throw new HttpError(409, `Este producto se activa en Solana. Recargá la página y volvé a escanear el QR.`);
  }
  return completeClaim(product, textField(body, 'owner').trim(), baseUrl, wantsShowcase(body, product));
};

// What the buyer sees after reading the secret QR and before activating: the model and whether the product can be shown
// on the home page. Whoever holds the QR could activate the product, so nothing here is more than that.
export const previewClaim = (body: JsonBody): ClaimPreview => {
  const key = textField(body, 'activationKey').toLowerCase();
  const product = /^[0-9a-f]{64}$/.test(key) ? [...store.products.values()].find((candidate) => activationKeyOf(candidate) === key) : undefined;
  if (!product) throw new HttpError(404, messages.qrNotFound);
  const blocked = product.claimed ? 'photo' : showcaseBlockOf(product.batchId);
  return { model: product.model, photoUrl: photoOfBatch(product.batchId), canShowcase: blocked === null, blocked };
};

export const warrantiesOf = (owner: string, baseUrl: string) => {
  if (!chain.isAddress(owner)) throw new HttpError(400, messages.invalidOwner);
  const warranties = [...store.products.values()]
    .filter((product) => product.claimed && product.owner === owner)
    .sort((first, second) => String(second.claimedAt ?? '').localeCompare(String(first.claimedAt ?? '')))
    .map((product) => warrantyView(product, baseUrl));
  return { owner, warranties, transferred: transferredBy(owner) };
};
