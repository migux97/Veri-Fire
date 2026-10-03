// Company purchases: a batch of products is paid in USDC with Solana Pay and minted once the payment is confirmed.
import { randomBytes, randomUUID } from 'node:crypto';
import { address, getBase58Decoder, type Address } from '@solana/kit';
import { parseIssuanceOptions } from '../issuance';
import type { CompanyBatch, CreatedPurchase, PublicBatch, PurchaseStatus, PurchaseSummary } from '../types';
import { isWalletAddress, normalizeId } from '../validation';
import { chain } from './chain';
import { config } from './config';
import { HttpError } from './errors';
import type { JsonBody } from './http';
import { publishedIssuerOf } from './brands';
import { photoPathOf, purchaseOfBatch } from './photos';
import { batchUrl, qrImage, secretUrl, verificationUrl } from './links';
import { singleton } from './singleton';
import { anchorPendingProducts, isCurrentOnChain, isPendingOnChain, mintProduct, readProductFields } from './products';
import { createSolanaClient, toBaseUnits } from './solana';
import { saveState, store, type Batch, type Purchase } from './store';
import { parseSupport } from './support';

const MAX_QUANTITY = 500;

const ASSET = 'USDC';

const solana = singleton('solana-payments', () => createSolanaClient(config.solana));

export const paymentsConfigured = () => isWalletAddress(config.payments.recipient) && isWalletAddress(config.payments.mint);

// The amount of a purchase in the token's base units (USDC has 6 decimals), from its total as text ("12.50").
const baseUnits = async (total: string) => toBaseUnits(total, await solana.tokenDecimals(address(config.payments.mint)));

// What every payment of this purchase has to match: the treasury, the token, the total and the purchase's own key.
const paymentOf = async (purchase: Purchase) => ({
  recipient: address(config.payments.recipient),
  mint: address(config.payments.mint),
  amount: await baseUnits(purchase.total),
  reference: address(purchase.reference)
});

// A Solana Pay transfer request: any Solana Pay wallet (Phantom, Solflare...) pays it from its QR.
const paymentUrl = (purchase: { total: string; reference: string; quantity: number; model: string }) => {
  const params = new URLSearchParams({
    amount: purchase.total,
    'spl-token': config.payments.mint,
    reference: purchase.reference,
    label: 'Verifire',
    message: `Emisión de ${purchase.quantity} tokens ${purchase.model}`
  });
  return `solana:${config.payments.recipient}?${params}`;
};

export const findBatch = (batchId: unknown) => store.batches.get(normalizeId(batchId));
export const findPurchase = (purchaseId: string) => store.purchases.get(purchaseId);

const batchBase = (batch: Batch, baseUrl: string) => ({
  batchId: batch.batchId,
  quantity: batch.tokens.length,
  model: batch.model,
  lot: batch.lot,
  destination: batch.destination,
  publicUrl: batchUrl(baseUrl, batch.batchId),
  network: config.network,
  blockchainBacked: chain.enabled
});

export const publicBatchView = (batch: Batch, baseUrl: string): PublicBatch => ({
  ...batchBase(batch, baseUrl),
  issuer: publishedIssuerOf(batch.batchId),
  photoUrl: photoPathOf(purchaseOfBatch(batch.batchId)),
  tokens: batch.tokens.map((product) => ({ token: product.token, status: product.claimed ? 'CLAIMED_IN_WARRANTY' : 'SEALED' }))
});

// Each product gets a public QR for the outside of the box and a secret QR for the inside.
export const companyBatchView = async (batch: Batch, baseUrl: string): Promise<CompanyBatch> => {
  const base = batchBase(batch, baseUrl);
  const tokens = await Promise.all(batch.tokens.map(async (product) => {
    const secretCode = product.secretCode ?? '';
    const productSecretUrl = secretUrl(baseUrl, secretCode);
    const publicUrl = verificationUrl(baseUrl, product.token);
    const [secretQr, publicQr] = await Promise.all([qrImage(productSecretUrl), qrImage(publicUrl)]);
    return {
      token: product.token,
      status: product.claimed ? 'CLAIMED_IN_WARRANTY' as const : 'SEALED' as const,
      secretCode,
      secretUrl: productSecretUrl,
      secretQr,
      publicUrl,
      publicQr
    };
  }));
  return {
    ...base,
    ...(batch.configuration ? { configuration: batch.configuration } : {}),
    publicQr: await qrImage(base.publicUrl),
    tokens,
    payment: { amount: batch.amount, asset: ASSET, pricePerToken: config.payments.pricePerToken }
  };
};

export const createBatchPayment = async (body: JsonBody): Promise<CreatedPurchase> => {
  const quantity = Number(body['quantity']);
  const fields = readProductFields(body);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || !fields) {
    throw new HttpError(400, `Indica una cantidad entre 1 y ${MAX_QUANTITY}, modelo, lote y destino.`);
  }

  let configuration;
  try { configuration = parseIssuanceOptions(body['configuration']); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Configuración inválida.'); }
  // The company's warranty settings at the time of buying; it can change them later for all its batches.
  const support = parseSupport(body['support']);
  const total = (Number(config.payments.pricePerToken) * quantity).toFixed(2);
  const purchaseId = `PUR-${randomUUID()}`;
  // A fresh key that only this purchase's payment carries: it is how the payment is found on-chain.
  const reference = getBase58Decoder().decode(randomBytes(32));
  const uri = paymentUrl({ total, reference, quantity, model: fields.model });
  const qr = await qrImage(uri);
  // The payment QR is kept so a pending purchase can be reopened from the company's list of batches.
  store.purchases.set(purchaseId, {
    purchaseId, quantity, ...fields, ...(configuration ? { configuration } : {}), ...(support ? { support } : {}), total, reference,
    createdAt: new Date().toISOString(), paymentQr: qr, paymentUri: uri
  });
  try {
    saveState();
  } catch (error) {
    // The client never learns its id, so nobody could ever pay or find it: it is not kept.
    store.purchases.delete(purchaseId);
    throw error;
  }
  return { purchaseId, quantity, amount: total, asset: ASSET, reference, status: 'pending', network: config.network, uri, qr };
};

// Idempotent: concurrent status checks for the same purchase create a single batch.
const finalizePurchase = (purchase: Purchase, txHash: string | null) => {
  if (!purchase.batchId) {
    // Random, like the product codes: the batch page is public, and numbered ids let anyone list every batch.
    store.nextBatchId++;
    let batchId: string;
    do batchId = `BATCH-${randomBytes(5).toString('hex').toUpperCase()}`;
    while (store.batches.has(batchId));
    const { model, lot, destination } = purchase;
    const tokens = Array.from({ length: purchase.quantity }, () => mintProduct({ model, lot, destination, batchId }));
    store.batches.set(batchId, { batchId, tokens, model, lot, destination, amount: purchase.total, txHash, ...(purchase.configuration ? { configuration: purchase.configuration } : {}), ...(purchase.support ? { support: purchase.support } : {}) });
    Object.assign(purchase, { batchId, txHash });
    saveState();
    // Registers the new products in the contract in the background; the QR sheet does not wait for it.
    anchorPendingProducts();
  }
};

const purchaseSummary = (purchase: Purchase): PurchaseSummary => {
  const tokens = (purchase.batchId && store.batches.get(purchase.batchId)?.tokens) || [];
  return {
    purchaseId: purchase.purchaseId,
    model: purchase.model,
    lot: purchase.lot,
    destination: purchase.destination,
    quantity: purchase.quantity,
    amount: purchase.total,
    asset: ASSET,
    // Purchases made before createdAt was stored use the date their products were created.
    createdAt: purchase.createdAt ?? tokens[0]?.createdAt ?? null,
    batchId: purchase.batchId ?? null,
    payment: purchase.batchId ? null : { qr: purchase.paymentQr ?? null, uri: purchase.paymentUri ?? null, network: config.network },
    issuanceTxUrl: chain.isTxId(purchase.txHash) ? chain.explorerTxUrl(purchase.txHash) : null,
    registeredOnChain: tokens.filter(isCurrentOnChain).length,
    pendingOnChain: chain.enabled ? tokens.filter(isPendingOnChain).length : 0,
    claimed: tokens.filter((product) => product.claimed).length,
    shippedAt: (purchase.batchId && store.batches.get(purchase.batchId)?.shippedAt) || null,
    photoUrl: photoPathOf(purchase)
  };
};

// Once per batch: every product records the shipment to the batch's destination in its history.
export const shipBatch = (purchase: Purchase) => {
  const batch = purchase.batchId ? store.batches.get(purchase.batchId) : undefined;
  if (!batch) throw new HttpError(409, 'Este lote todavía no existe: falta confirmar el pago.');
  if (!batch.shippedAt) {
    batch.shippedAt = new Date().toISOString();
    for (const product of batch.tokens) (product.events ??= []).push({ kind: 'shipped', at: batch.shippedAt });
    saveState();
  }
  return { purchase: purchaseSummary(purchase) };
};

// The company pays from its Privy wallet: without signedTx the server answers the payment transaction for it to sign,
// with it the server pays its fee, sends it and issues the batch. The transaction must be exactly that payment.
export const payFromWallet = async (purchase: Purchase, body: JsonBody, baseUrl: string) => {
  const payer = String(body['payer'] ?? '').trim();
  if (!isWalletAddress(payer)) throw new HttpError(400, 'Indica la wallet que paga.');
  const status = await purchaseStatus(purchase, { summaryOnly: true, baseUrl });
  if (status.succeeded) return status;
  const payment = { ...(await paymentOf(purchase)), payer: address(payer) as Address };
  const signedTx = String(body['signedTx'] ?? '');
  if (!signedTx) return { tx: await solana.buildPayment(payment) };
  const signature = await solana.submitPayment({ ...payment, signedTx });
  finalizePurchase(purchase, signature);
  return purchaseStatus(purchase, { summaryOnly: true, baseUrl });
};

// Checks the payment and returns the batch with its secret codes and QR images. With summaryOnly it returns only
// the summary, for the list of batches.
export const purchaseStatus = async (purchase: Purchase, { summaryOnly, baseUrl }: { summaryOnly: boolean; baseUrl: string }): Promise<PurchaseStatus> => {
  if (!purchase.batchId) {
    let signature;
    try {
      signature = await solana.findPayment(await paymentOf(purchase));
    } catch (error) {
      // The list still shows a pending purchase when Solana cannot be reached; the next check retries.
      if (!summaryOnly) throw error;
      console.error('Solana Pay status error (summary):', error instanceof Error ? error.message : error);
      return { status: 'unknown', succeeded: false, purchase: purchaseSummary(purchase) };
    }
    if (!signature) return { status: 'pending', succeeded: false, txHash: null, purchase: purchaseSummary(purchase) };
    finalizePurchase(purchase, signature);
  }
  const batch = purchase.batchId ? store.batches.get(purchase.batchId) : undefined;
  return {
    status: 'succeeded',
    succeeded: true,
    paymentValidated: true,
    purchase: purchaseSummary(purchase),
    ...(summaryOnly || !batch ? {} : { batch: await companyBatchView(batch, baseUrl) })
  };
};
