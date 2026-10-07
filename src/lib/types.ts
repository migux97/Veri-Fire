import type { IssuanceOptions } from './issuance';
import type { CopySignal } from './scan-signals';
// Shapes of the JSON the API answers with. Shared by the server that builds them and the pages that read them.

export type ProductStatus = 'SEALED' | 'CLAIMED_IN_WARRANTY';

// Moments of a product's life, oldest first. Registration, activation and transfers are Solana transactions.
export type HistoryKind = 'minted' | 'shipped' | 'verified' | 'activated' | 'rejected' | 'transferred';

export interface HistoryEvent {
  kind: HistoryKind;
  at: string;
  // Short context: the lot, the destination, or owners as shortened Solana addresses.
  detail: string | null;
  // The Solana transaction behind the event, when there is one.
  txUrl: string | null;
  // Transfers: the new owner, as a shortened Solana address.
  to: string | null;
}

export interface ApiErrorBody {
  error: string;
  retryable?: boolean;
}

// Who issued a product, as the company chose to show itself. `verified` is the only part Verifire vouches for: it means
// an administrator checked the company by hand and the name is still the one that was checked (see verification.ts).
// Without it the name is only what the company wrote about itself.
export interface Issuer {
  name: string;
  logoUrl: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  verified: boolean;
  // The site of the company that Verifire confirmed, when it did.
  domain: string | null;
}

// Where a company stands in its verification, for the company itself and for whoever reviews it.
export interface VerificationState {
  status: 'none' | 'pending' | 'verified' | 'rejected';
  // Verified and still showing the verified name: the only case that reaches the public.
  active: boolean;
  name?: string;
  domain?: string;
  note?: string;
  message?: string;
  requestedAt?: string;
  decidedAt?: string;
}

// One company in the review panel: what it declared and what it did, so the person deciding has something to check.
export interface CompanyForReview {
  owner: string;
  companyName: string;
  brandName: string | null;
  verification: VerificationState;
  profile: Record<'legalName' | 'taxId' | 'website' | 'email' | 'phone' | 'country' | 'address' | 'industry', string>;
  stats: { purchases: number; batches: number; products: number; claimed: number };
  updatedAt: string;
}

// What the QR on the outside of the box shows to anyone, without a session. Owners appear only shortened, in the history.
export interface PublicProduct {
  token: string;
  model: string;
  lot: string;
  destination: string;
  status: ProductStatus;
  claimed: boolean;
  claimedAt: string | null;
  warrantyUntil: string | null;
  network: string;
  blockchainBacked: boolean;
  history: HistoryEvent[];
  // How many people have owned it: 0 while sealed, then the buyer plus one per transfer.
  owners: number;
  // The latest sign that its labels were copied (a second activation attempt, checks from distant places), if any.
  copySignal: CopySignal | null;
  // The last change of owner, when the product was passed on after its activation.
  lastTransfer: { to: string; at: string } | null;
  // The company's published brand, when it published one. Nothing private: only what it chose to show to everyone.
  issuer: Issuer | null;
  // What the batch looks like, when its company added a photo.
  photoUrl: string | null;
}

export interface Warranty extends PublicProduct {
  tokenId: number;
  owner: string | null;
  // The activation transaction signed by the issuing account: the only on-chain record a buyer ever sees.
  certificateUrl: string | null;
  verificationUrl: string;
  activationUrl: string;
  contractId: string | null;
  chainTokenId: number | null;
  // Registered in the current contract, so the owner can pass it on.
  transferable: boolean;
  // When the owner opened a transfer link that nobody accepted yet and has not expired, and when it expires.
  transferOfferedAt: string | null;
  transferExpiresAt: string | null;
  // The company that issued it and its support email, when the company set one.
  support: { company: string; email: string } | null;
  // Who issued it for its owner: the published brand, or the name and email set for support when there is none.
  issuer: Issuer | null;
  // The owner chose to show it on the home page, and whether that is possible: it needs a photo of the batch and an issuer
  // verified by Verifire. `showcaseBlocked` says which of the two is missing.
  showcase: boolean;
  canShowcase: boolean;
  showcaseBlocked: 'photo' | 'unverified' | null;
}

// What a buyer learns about a product when its secret QR is read, before activating it: enough to decide whether to
// show it on the home page.
export interface ClaimPreview {
  model: string;
  photoUrl: string | null;
  canShowcase: boolean;
  // Why it cannot be shown on the home page, when it cannot.
  blocked: 'photo' | 'unverified' | null;
}

// A product on the home page: only what its owner agreed to show. The owner's account is never part of it.
export interface ShowcaseItem {
  token: string;
  model: string;
  lot: string;
  destination: string;
  photoUrl: string;
  verifiedAt: string;
  issuer: { name: string; logoUrl: string | null } | null;
  onChain: boolean;
}

// Answer of POST /api/products, the only one that carries the secret code of a single product.
export interface MintedProduct extends Warranty {
  secretCode?: string;
  secretUrl?: string;
}

// A product this account owned and passed on: to whom it went, and the product's history since.
export interface TransferredWarranty {
  token: string;
  model: string;
  to: string;
  at: string;
  txUrl: string | null;
  history: HistoryEvent[];
}

export interface WarrantiesResponse {
  owner: string;
  warranties: Warranty[];
  transferred: TransferredWarranty[];
}

export interface BatchToken {
  token: string;
  status: ProductStatus;
}

// A public QR for the outside of the box and a secret QR for the inside.
export interface ProductLabel extends BatchToken {
  secretCode: string;
  secretUrl: string;
  secretQr: string;
  publicUrl: string;
  publicQr: string;
}

interface BatchBase {
  batchId: string;
  quantity: number;
  model: string;
  lot: string;
  destination: string;
  publicUrl: string;
  network: string;
  blockchainBacked: boolean;
}

export interface PublicBatch extends BatchBase {
  issuer: Issuer | null;
  photoUrl: string | null;
  tokens: BatchToken[];
}

// What the batch cost is company data: it travels only with the secret codes, never on the public lot page.
export interface CompanyBatch extends BatchBase {
  configuration?: IssuanceOptions;
  publicQr: string;
  tokens: ProductLabel[];
  payment: { amount: string; asset: 'USDC'; pricePerToken: string };
}

// What the company's list of batches shows for a purchase: no secret codes and no QR images.
export interface PurchaseSummary {
  purchaseId: string;
  model: string;
  lot: string;
  destination: string;
  quantity: number;
  amount: string;
  asset: 'USDC';
  createdAt: string | null;
  batchId: string | null;
  // The payment QR, kept so a pending purchase can be paid from the list. Null once the batch exists.
  // network: the Solana cluster where the payment is made. recipient and transferAmount: the treasury and the exact amount
  // for a transfer made by hand, without the QR (its last decimals identify the purchase).
  payment: { qr: string | null; uri: string | null; network?: string; recipient?: string | null; transferAmount?: string | null } | null;
  issuanceTxUrl: string | null;
  registeredOnChain: number;
  pendingOnChain: number;
  claimed: number;
  // When the company marked the batch as shipped to its destination.
  shippedAt: string | null;
  // The photo of the batch, when the company added one.
  photoUrl: string | null;
}

export type PurchaseStatus =
  | { status: string; succeeded: false; txHash?: string | null; purchase: PurchaseSummary }
  | { status: 'succeeded'; succeeded: true; paymentValidated: true; purchase: PurchaseSummary; batch?: CompanyBatch };

export interface CreatedPurchase {
  purchaseId: string;
  quantity: number;
  amount: string;
  asset: string;
  reference: string;
  status: string;
  network: string;
  uri: string;
  qr: string;
  // For a transfer made by hand: the treasury and the exact amount to send.
  recipient: string;
  transferAmount: string;
}

export type TeamRole = 'admin' | 'operator' | 'auditor' | 'viewer';

// An invitation to a company's team, as the invitee and the inviter see it. Its secret token is not part of it.
export interface InvitationView {
  id: string;
  companyName: string;
  inviterName: string;
  role: TeamRole;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  // Who it is for. Empty for an open link.
  email: string;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  acceptedBy: string | null;
  // Milliseconds left when the server answered, measured with its own clock.
  expiresInMs: number;
}

// An invitation waiting in the invitee's panel, with the token needed to answer it.
export interface InboxInvitation extends InvitationView {
  token: string;
}

export interface CountryOption {
  code: string;
  name: string;
  region: string;
  // Printed on the labels, e.g. "Argentina · LATAM".
  destination: string;
}

export type PreparedClaim = { onChain: false } | { onChain: true; message: string };

// An unsigned transaction for the user's wallet: a base64 wire transaction.
export interface UnsignedTransaction {
  tx: string;
}

// What a transfer link offers, shown to the recipient before accepting, and the message the link's key must sign.
export interface PreparedTransfer {
  token: string;
  model: string;
  from: string;
  message: string;
  expiresAt: string;
  // The time left, measured by the server: the recipient's clock may be off by minutes.
  expiresInMs: number;
}
