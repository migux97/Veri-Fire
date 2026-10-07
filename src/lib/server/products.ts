import { randomBytes } from 'node:crypto';
import type { HistoryEvent, MintedProduct, ProductStatus, PublicProduct, TransferredWarranty, Warranty } from '../types';
import { normalizeId } from '../validation';
import { chain } from './chain';
import { config } from './config';
import { destinationForCountry } from './countries';
import { textField, type JsonBody } from './http';
import { activationUrl, secretUrl, verificationUrl } from './links';
import { singleton } from './singleton';
import { shortAddress } from '../format';
import { hashSecret, saveState, store, type Product, type ProductFields, type StoredEvent } from './store';
import { issuerOf, publishedIssuerOf } from './brands';
import { photoOfBatch } from './photos';
import { showcaseBlockOf } from './showcase-rules';
import { copySignalOf, ownersCount } from '../scan-signals';
import { DEFAULT_WARRANTY_MONTHS, supportOf } from './support';

const HOUR_MS = 60 * 60 * 1000;
// Public checks of one product counted in its history: one per half day, the latest ones only.
const VERIFIED_EVERY_MS = 12 * HOUR_MS;
const MAX_VERIFIED_EVENTS = 30;
// Rejected attempts are recorded from an address nobody had to prove owning, so they are capped like the checks are.
const MAX_REJECTED_EVENTS = 20;
// A transfer link can be accepted for TRANSFER_LINK_MS. The contract enforces the same time (TRANSFER_LINK_SECONDS in its lib.rs).
export const TRANSFER_LINK_MS = 15 * 60 * 1000;

// The product's transfer link while it can still be accepted.
export const openTransferOf = (product: Product) => {
  const { transfer } = product;
  if (!transfer) return null;
  const expiresAt = transfer.expiresAt ?? new Date(new Date(transfer.offeredAt).getTime() + TRANSFER_LINK_MS).toISOString();
  return Date.now() <= new Date(expiresAt).getTime() ? { ...transfer, expiresAt } : null;
};

const warrantyUntil = (product: Product) => {
  if (!product.claimedAt) return null;
  const date = new Date(product.claimedAt);
  const day = date.getUTCDate();
  // Day 1 first, so a month-end activation lands on the target month (Aug 31 + 6 months is Feb 28, not Mar 3).
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + (product.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
};

const statusOf = (product: Product): ProductStatus => (product.claimed ? 'CLAIMED_IN_WARRANTY' : 'SEALED');

// A product renamed because its code was taken in the contract is still found by its old code, the one its printed
// labels carry.
export const findProduct = (token: unknown) => {
  const code = normalizeId(token);
  return store.products.get(code) ?? store.products.get(store.productAliases.get(code) ?? '');
};

// Registered in the contract this server uses now, not only in one that a later deploy replaced.
export const isCurrentOnChain = (product: Product): product is Product & { chain: NonNullable<Product['chain']> } =>
  Boolean(product.chain
    && Number.isInteger(product.chain.tokenId)
    && config.contractId
    // A product registered before the program id was stored is taken as registered in the current one: minting it
    // again would be refused and leave it "registrándose" forever.
    && (product.chain.contractId ?? config.contractId) === config.contractId);

const txUrlOf = (tx: string | undefined) => (chain.isTxId(tx) ? chain.explorerTxUrl(tx) : null);

// Whoever activated the warranty: the first transfer's previous owner, or the current owner if it never moved.
const firstOwner = (product: Product) => product.events?.find((event) => event.kind === 'transferred')?.from ?? product.owner;

const storedEventView = (product: Product, event: StoredEvent): HistoryEvent => {
  const details: Record<StoredEvent['kind'], string | null> = {
    shipped: `Destino ${product.destination}`,
    verified: null,
    rejected: 'El producto ya tenía dueño: el QR secreto pudo haber sido copiado',
    transferred: `Dueño anterior: ${shortAddress(event.from)}`
  };
  return {
    kind: event.kind, at: event.at, detail: details[event.kind], txUrl: txUrlOf(event.tx),
    to: event.kind === 'transferred' ? shortAddress(event.to) : null
  };
};

const transfersOf = (product: Product) => (product.events ?? []).filter((event) => event.kind === 'transferred');

// Oldest first. Registration and activation come from the product itself, so older products have a history too.
export const historyOf = (product: Product): HistoryEvent[] => {
  const history: HistoryEvent[] = [];
  const registeredAt = product.createdAt ?? product.chain?.at;
  if (registeredAt) {
    history.push({ kind: 'minted', at: registeredAt, detail: `Lote ${product.lot}`, txUrl: isCurrentOnChain(product) ? txUrlOf(product.chain?.mintTx) : null, to: null });
  }
  if (product.claimed && product.claimedAt) {
    history.push({ kind: 'activated', at: product.claimedAt, detail: `Dueño ${shortAddress(firstOwner(product))}`, txUrl: txUrlOf(product.claimTransaction), to: null });
  }
  for (const event of product.events ?? []) history.push(storedEventView(product, event));
  return history.sort((first, second) => first.at.localeCompare(second.at));
};

export const recordEvent = (product: Product, event: StoredEvent) => {
  (product.events ??= []).push(event);
  saveState();
};

// A note in the history, for pages that must answer even when the state cannot be written.
const recordEventQuietly = (product: Product, event: StoredEvent) => {
  try {
    recordEvent(product, event);
  } catch (error) {
    console.error(`No se pudo registrar el evento ${event.kind} de ${product.token}:`, error);
  }
};

// Each public check of the product, at most one every VERIFIED_EVERY_MS so reloading the page adds nothing. A check
// from another country is always recorded: it is what tells a copied public QR apart (see scan-signals.ts).
export const recordVerification = (product: Product, country: string | null = null) => {
  const events = product.events ?? [];
  const last = events.findLast((event) => event.kind === 'verified');
  const sameCountry = !country || !last?.country || last.country === country;
  if (last && sameCountry && Date.now() - new Date(last.at).getTime() < VERIFIED_EVERY_MS) return;
  const verified = events.filter((event) => event.kind === 'verified');
  if (verified.length >= MAX_VERIFIED_EVENTS) product.events = events.filter((event) => event !== verified[0]);
  recordEventQuietly(product, { kind: 'verified', at: new Date().toISOString(), ...(country ? { country } : {}) });
};

// Someone with the secret QR tried to activate a product that already has an owner: a sign of a copied label.
// Once a day per account, since a single attempt goes through several requests.
export const recordRejectedClaim = (product: Product, claimant: string) => {
  const events = product.events ?? [];
  const recent = events.some((event) => event.kind === 'rejected' && event.by === claimant && Date.now() - new Date(event.at).getTime() < 24 * HOUR_MS);
  if (recent) return;
  const rejected = events.filter((event) => event.kind === 'rejected');
  if (rejected.length >= MAX_REJECTED_EVENTS) product.events = events.filter((event) => event !== rejected[0]);
  recordEventQuietly(product, { kind: 'rejected', at: new Date().toISOString(), by: claimant });
};

export const publicProductView = (product: Product): PublicProduct => ({
  token: product.token,
  model: product.model,
  lot: product.lot,
  destination: product.destination,
  status: statusOf(product),
  claimed: product.claimed,
  claimedAt: product.claimedAt ?? null,
  warrantyUntil: warrantyUntil(product),
  network: config.network,
  // True only for products registered in the contract, not merely because a contract is configured.
  blockchainBacked: isCurrentOnChain(product),
  history: historyOf(product),
  owners: ownersCount(product.claimed, product.events ?? []),
  copySignal: copySignalOf(product.events ?? []),
  lastTransfer: (() => {
    const last = transfersOf(product).at(-1);
    return last ? { to: shortAddress(last.to), at: last.at } : null;
  })(),
  issuer: publishedIssuerOf(product.batchId),
  photoUrl: photoOfBatch(product.batchId)
});

// Products this account passed on and no longer owns, the latest first. When it owned one twice, the last time counts.
export const transferredBy = (owner: string): TransferredWarranty[] =>
  [...store.products.values()]
    .filter((product) => product.owner !== owner && product.events?.some((event) => event.kind === 'transferred' && event.from === owner))
    .flatMap((product) => {
      const given = transfersOf(product).findLast((event) => event.from === owner);
      return given ? [{
        token: product.token,
        model: product.model,
        to: shortAddress(given.to),
        at: given.at,
        txUrl: txUrlOf(given.tx),
        history: historyOf(product)
      }] : [];
    })
    .sort((first, second) => second.at.localeCompare(first.at));

// What the buyer may see is the certification only: the activation transaction signed by the issuing account.
// The Solana Pay payment that bought the batch moves company money and never leaves the company panel.
export const warrantyView = (product: Product, baseUrl: string): Warranty => ({
  ...publicProductView(product),
  certificateUrl: txUrlOf(product.claimTransaction),
  tokenId: product.tokenId,
  owner: product.owner,
  verificationUrl: verificationUrl(baseUrl, product.token),
  activationUrl: activationUrl(baseUrl),
  contractId: config.contractId,
  chainTokenId: isCurrentOnChain(product) ? product.chain?.tokenId ?? null : null,
  transferable: product.claimed && isCurrentOnChain(product),
  transferOfferedAt: openTransferOf(product)?.offeredAt ?? null,
  transferExpiresAt: openTransferOf(product)?.expiresAt ?? null,
  // Only for the owner: the company that issued the product and the email it set for support.
  support: (() => {
    const support = supportOf(product);
    return support ? { company: support.companyName, email: support.email } : null;
  })(),
  // The same company as the buyer sees it: its name and, when it published them, its logo and how to reach it.
  issuer: issuerOf(product, supportOf(product)),
  showcase: Boolean(product.showcase),
  canShowcase: showcaseBlockOf(product.batchId) === null,
  showcaseBlocked: showcaseBlockOf(product.batchId)
});

export const mintedProductView = (product: Product, baseUrl: string): MintedProduct => ({
  ...warrantyView(product, baseUrl),
  ...(product.secretCode ? { secretCode: product.secretCode, secretUrl: secretUrl(baseUrl, product.secretCode) } : {})
});

export const readProductFields = (body: JsonBody): ProductFields | null => {
  const fields = {
    model: (textField(body, 'model') || textField(body, 'name')).trim(),
    lot: textField(body, 'lot').trim(),
    // The market comes from the list of countries, and the server (not the browser) turns it into the destination
    // printed on the labels. Free text is still accepted for batches created before the list existed.
    destination: destinationForCountry(body['country']) || textField(body, 'destination').trim()
  };
  const valid = fields.model && fields.model.length <= 120
    && fields.lot && fields.lot.length <= 60
    && fields.destination && fields.destination.length <= 40;
  return valid ? fields : null;
};

// Public codes are random, not VF-001, VF-002...: several servers (each developer's, the demo, production) can share
// one contract, and numbered codes from each of them collided there, leaving the products unregistered for good.
// No 0/O, 1/I/L: the code is also read and typed by people.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newProductCode = () => {
  for (;;) {
    const code = `VF-${[...randomBytes(8)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}`;
    if (!store.products.has(code)) return code;
  }
};

export const mintProduct = (fields: ProductFields & { batchId?: string }) => {
  const tokenId = store.nextTokenId++;
  const token = newProductCode();
  const secretCode = `VF-SECRET-${randomBytes(10).toString('hex').toUpperCase()}`;
  const product: Product = {
    tokenId, token, ...fields, secretCode, secretHash: hashSecret(secretCode), claimed: false, owner: null, createdAt: new Date().toISOString()
  };
  store.products.set(token, product);
  return product;
};

// Key the browser derives from the QR to find its product without sending the secret. The seed product has no
// secret code, so it keeps the local demo claim.
export const activationKeyOf = (product: Product) => {
  if (!product.secretCode) return '';
  product.activationKey ||= chain.activationKeyFor(product.secretCode).toString('hex');
  return product.activationKey;
};

// Products still waiting to be registered in the current contract: new ones, and after a new deploy every product of
// the replaced program. Only sealed ones: an activated product has an owner the server cannot sign for.
export const isPendingOnChain = (product: Product) =>
  Boolean(product.secretCode) && !isCurrentOnChain(product) && !product.claimed;

// Registers pending products in the program, one transaction each. A failure is logged and retried on the
// next pass: new products, a claim attempt for an unregistered product, or a server restart.
const anchoring = singleton('anchoring', () => ({ running: false, again: false }));

export const anchorPendingProducts = () => {
  if (!chain.enabled) return;
  if (anchoring.running) {
    anchoring.again = true;
    return;
  }
  anchoring.running = true;
  void (async () => {
    do {
      anchoring.again = false;
      for (const product of [...store.products.values()].filter(isPendingOnChain)) {
        try {
          // The code may already be in the contract: this product registered by a run whose answer was lost, or
          // another product from another server that shares the contract.
          const existing = await chain.productByCode(product.token);
          if (existing && !product.claimed && existing.activationKey.equals(chain.activationKeyFor(product.secretCode ?? ''))) {
            // Its mint transaction is not known here (the one saved may belong to a replaced contract).
            product.chain = { tokenId: existing.tokenId, mintTx: '', contractId: chain.deploymentId, at: new Date().toISOString() };
            delete product.transfer;
            saveState();
            continue;
          }
          if (existing && product.claimed) {
            // An activated warranty keeps the code its owner knows: this needs a person to look at it.
            console.error(`El código ${product.token} ya existe en el contrato con otro producto y su garantía ya está activada.`);
            continue;
          }
          if (existing) {
            // Someone else's product holds the code: this one could never be registered with it. It gets a new code,
            // so its labels have to be downloaded again (their QR carry the code).
            const previous = product.token;
            store.products.delete(previous);
            product.token = newProductCode();
            store.products.set(product.token, product);
            // The labels already printed keep working: their code answers with this product.
            store.productAliases.set(previous, product.token);
            for (const [alias, target] of store.productAliases) if (target === previous) store.productAliases.set(alias, product.token);
            saveState();
            console.warn(`El código ${previous} ya existe en el contrato con otro producto: ahora es ${product.token}.`);
          }
          const toMint = { ...product, secretCode: product.secretCode ?? '' };
          const registered = await chain.mintProduct(toMint);
          product.chain = { ...registered, contractId: chain.deploymentId, at: new Date().toISOString() };
          // A link opened in the replaced contract does not exist in the new one.
          delete product.transfer;
          saveState();
        } catch (error) {
          console.error(`No se pudo registrar ${product.token} en Solana:`, error instanceof Error ? error.message : error);
        }
      }
    } while (anchoring.again);
  })().finally(() => {
    anchoring.running = false;
  });
};

// Products whose registration failed or was interrupted by a restart are retried as soon as the server loads this
// module, which happens with the first request that reads products.
singleton('anchoring-on-start', () => {
  anchorPendingProducts();
  if (!chain.enabled) console.info(`Sin SOLANA_PROGRAM_ID: las garantías se guardan solo en este servidor (modo demo).`);
  else console.info(`Garantías registradas en Solana: ${config.contractId}`);
  return true;
});
