// A purchase id is the key to the secret codes of its batch, so the list lives in this browser, per account. It is
// also kept beside the account's wallet, which is what lets another browser find the same batches after signing in
// (see workspace-sync.ts). Shared by the buy page and the list of batches.
import type { IssuanceOptions } from '../issuance';
import type { CreatedPurchase, PurchaseStatus, PurchaseSummary } from '../types';
import { getJson, postJson } from './api';
import { notify } from './notifications';
import { accountKey, userSession } from './session';
import { readStored, writeStored } from './storage';

const LEGACY_PURCHASE_KEY = 'verifireLastPurchase';
const purchasesKey = () => `verifireCompanyPurchases:${userSession.email().toLowerCase()}`;

// Last known state of each purchase, to notify only what changes: a payment confirmed, a batch created.
interface KnownState {
  paid: boolean;
  batch: boolean;
}
const statesKey = () => accountKey('purchase-states');
const readStates = () => readStored<Record<string, KnownState>>(localStorage, statesKey()) ?? {};

const trackPurchase = (status: PurchaseStatus) => {
  const { purchase } = status;
  const states = readStates();
  const known = states[purchase.purchaseId];
  const now: KnownState = { paid: status.succeeded, batch: Boolean(purchase.batchId) };
  // A purchase first seen already paid (another browser, an old list) is only recorded: nothing new happened here.
  if (known && !known.paid && now.paid) {
    notify({
      id: `paid:${purchase.purchaseId}`,
      kind: 'paymentSucceeded',
      params: { amount: purchase.amount, model: purchase.model },
      href: '#batches'
    });
  }
  if (known && !known.batch && now.batch) {
    notify({
      id: `batch:${purchase.purchaseId}`,
      kind: 'batchCreated',
      params: { batchId: purchase.batchId ?? '', model: purchase.model, quantity: String(purchase.quantity) },
      href: '#batches'
    });
  }
  if (!known || known.paid !== now.paid || known.batch !== now.batch) writeStored(localStorage, statesKey(), { ...states, [purchase.purchaseId]: now });
  return status;
};

export const savedPurchaseIds = (): string[] => realPurchaseIds();

// The company's purchases, as this browser keeps them.
export const realPurchaseIds = (): string[] => {
  const list = readStored<unknown>(localStorage, purchasesKey());
  if (!Array.isArray(list)) return [];
  return list
    .map((item: unknown) => (typeof item === 'object' && item !== null ? (item as { purchaseId?: unknown }).purchaseId : undefined))
    .filter((id): id is string => typeof id === 'string');
};

const writePurchaseIds = (ids: string[]) => {
  try {
    writeStored(localStorage, purchasesKey(), ids.map((purchaseId) => ({ purchaseId })));
  } catch {
    // Without storage the list only lasts while the page is open.
  }
};

// Tells the list of batches of the same page that a purchase was added.
export const PURCHASES_CHANGED_EVENT = 'verifire:purchases-changed';

// A purchase created here starts as unpaid, so its payment and its batch are notified when they arrive.
export const savePurchase = (purchaseId: string) => {
  writeStored(localStorage, statesKey(), { ...readStates(), [purchaseId]: { paid: false, batch: false } });
  writePurchaseIds([purchaseId, ...realPurchaseIds().filter((id) => id !== purchaseId)]);
  window.dispatchEvent(new Event(PURCHASES_CHANGED_EVENT));
};

// Purchases the account already had, brought from the server: what this browser knows is kept, nothing is replaced.
export const addPurchaseIds = (purchaseIds: string[]) => {
  const known = savedPurchaseIds();
  const forgotten = forgottenPurchaseIds();
  const missing = purchaseIds.filter((purchaseId) => !known.includes(purchaseId) && !forgotten.includes(purchaseId));
  if (!missing.length) return;
  writePurchaseIds([...known, ...missing]);
  window.dispatchEvent(new Event(PURCHASES_CHANGED_EVENT));
};

// Purchases removed from the list by hand. Kept so the account sync drops them on the server too and does not bring
// them back; buying again with the same id is impossible, so the list only grows with what the user removed.
const forgottenKey = () => `verifireForgottenPurchases:${userSession.email().toLowerCase()}`;
export const forgottenPurchaseIds = (): string[] => {
  const saved = readStored<unknown>(localStorage, forgottenKey());
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(-500) : [];
};

export const forgetPurchase = (purchaseId: string) => {
  writePurchaseIds(realPurchaseIds().filter((id) => id !== purchaseId));
  writeStored(localStorage, forgottenKey(), [...forgottenPurchaseIds().filter((id) => id !== purchaseId), purchaseId]);
  window.dispatchEvent(new Event(PURCHASES_CHANGED_EVENT));
};

// The panel used to keep only the last purchase under its own key; it moves into the list once.
export const migrateLegacyPurchase = () => {
  const legacy = readStored<{ purchaseId?: unknown }>(localStorage, LEGACY_PURCHASE_KEY);
  if (typeof legacy?.purchaseId === 'string' && !realPurchaseIds().includes(legacy.purchaseId)) savePurchase(legacy.purchaseId);
  try {
    localStorage.removeItem(LEGACY_PURCHASE_KEY);
  } catch {
    // A legacy entry that cannot be removed is ignored next time too.
  }
};

// The summary of a purchase: enough to list and count batches, with no secret code and no QR image.
export const fetchPurchase = async (purchaseId: string) =>
  trackPurchase(
    await getJson<PurchaseStatus>(`/api/purchases/${encodeURIComponent(purchaseId)}`, 'No se pudo consultar la compra.')
  );

// The batch with the secret code and the QR images of every product. Asked for with the id in the body, never in the
// URL: the id is the only key to those codes and it cannot be rotated.
export const fetchPurchaseDetail = async (purchaseId: string) =>
  trackPurchase(
    await postJson<PurchaseStatus>('/api/purchases/detail', { purchaseId }, 'No se pudo consultar la compra.')
  );

export interface PurchaseRequest {
  model: string;
  lot: string;
  country: string;
  quantity: number;
  configuration?: IssuanceOptions;
  // The company's warranty settings (support email, warranty length), carried by the new batch.
  support?: { companyName: string; email: string; warrantyMonths: number };
}

// Creates the Solana Pay payment of a new batch.
export const createPurchase = (request: PurchaseRequest, fallbackError: string) =>
  postJson<CreatedPurchase>('/api/purchases', request, fallbackError);

export const shipPurchase = (purchaseId: string, fallbackError: string) =>
  postJson<{ purchase: PurchaseSummary }>(`/api/purchases/${encodeURIComponent(purchaseId)}/ship`, {}, fallbackError);
