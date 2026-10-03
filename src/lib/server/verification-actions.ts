// Asking for a verification and deciding on it. A company asks with its own wallet's signature; deciding, and even
// reading the list of companies, needs the signature of a wallet listed in ADMIN_WALLETS. See verification.ts.
import type { CompanyForReview } from '../types';
import { isWalletAddress } from '../validation';
import { config } from './config';
import { HttpError } from './errors';
import { saveState, store, type Verification, type Workspace } from './store';
import { sameName, verificationView } from './verification';
import { workspaceView } from './workspaces';

export const isAdminWallet = (owner: string) => config.adminWallets.includes(owner);

export const assertAdmin = (owner: string) => {
  if (!isAdminWallet(owner)) throw new HttpError(403, 'Tu cuenta no administra Verifire.');
};

const MESSAGE_LIMIT = 500;
const NOTE_LIMIT = 300;

const cleanText = (value: unknown, limit: number) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > limit) throw new HttpError(400, `El texto es demasiado largo (máximo ${limit} caracteres).`);
  return text;
};

// "https://www.AndesTech.com/quienes-somos" → "andestech.com". Empty when there is none; an error when it is not a site.
const cleanDomain = (value: unknown) => {
  const raw = cleanText(value, 200).toLowerCase();
  if (!raw) return '';
  const host = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0] ?? '';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    throw new HttpError(400, 'El sitio de la empresa no es válido. Escribí solo el dominio, por ejemplo andestech.com.');
  }
  return host;
};

// Changes what the server keeps for a company, and puts it back if it cannot be saved.
const change = (workspace: Workspace, verification: Verification) => {
  const before = workspace.verification;
  workspace.verification = verification;
  try {
    saveState();
  } catch (error) {
    if (before) workspace.verification = before;
    else delete workspace.verification;
    throw error;
  }
};

// The company asks to be verified. A rejected one asks again after fixing what was wrong; one that was verified but
// changed its name asks for the new one.
export const requestVerification = (owner: string, message: unknown) => {
  const workspace = store.workspaces.get(owner);
  if (!workspace || workspaceView(owner).accountType !== 'business') {
    throw new HttpError(409, 'Solo una empresa puede pedir la verificación. Registrá tu empresa primero.');
  }
  const current = workspace.verification;
  const active = verificationView(workspace).active;
  if (active) throw new HttpError(409, 'Tu empresa ya está verificada.');
  // Asking again while waiting keeps the first date and, without a new message, the one already written.
  const waiting = current?.status === 'pending';
  const text = cleanText(message, MESSAGE_LIMIT) || (waiting ? current.message ?? '' : '');
  change(workspace, {
    status: 'pending',
    requestedAt: waiting && current.requestedAt ? current.requestedAt : new Date().toISOString(),
    ...(text ? { message: text } : {})
  });
  return verificationView(workspace);
};

const profileOf = (workspace: Workspace): CompanyForReview['profile'] => {
  const stored = workspace.data?.['company-profile']?.value;
  const profile = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const read = (key: string) => (typeof profile[key] === 'string' ? (profile[key] as string).slice(0, 200) : '');
  return {
    legalName: read('legalName'),
    taxId: read('taxId'),
    website: read('website'),
    email: read('email'),
    phone: read('phone'),
    country: read('country'),
    address: read('address'),
    industry: read('industry')
  };
};

const ORDER = { pending: 0, verified: 1, none: 2, rejected: 3 } as const;

// Every company, the ones waiting first. Only for an administrator.
export const companiesForReview = (): CompanyForReview[] =>
  [...store.workspaces.values()]
    .filter((workspace) => workspaceView(workspace.owner).accountType === 'business')
    .map((workspace): CompanyForReview => {
      const purchases = [...store.purchases.values()].filter((purchase) => purchase.owner === workspace.owner);
      const batches = purchases.flatMap((purchase) => (purchase.batchId ? [store.batches.get(purchase.batchId)] : [])).filter((batch) => batch !== undefined);
      const products = batches.flatMap((batch) => batch.tokens);
      return {
        owner: workspace.owner,
        companyName: workspace.companyName ?? '',
        brandName: workspace.brand?.name ?? null,
        verification: verificationView(workspace),
        profile: profileOf(workspace),
        stats: {
          purchases: purchases.length,
          batches: batches.length,
          products: products.length,
          claimed: products.filter((product) => product.claimed).length
        },
        updatedAt: workspace.updatedAt
      };
    })
    .sort((first, second) => {
      const byStatus = ORDER[first.verification.status] - ORDER[second.verification.status];
      if (byStatus) return byStatus;
      // Waiting: the one that asked first; the rest: the most recent.
      return first.verification.status === 'pending'
        ? String(first.verification.requestedAt).localeCompare(String(second.verification.requestedAt))
        : second.updatedAt.localeCompare(first.updatedAt);
    });

// The administrator decides: `approve` records the name (and site) that were checked; `reject` gives the company a
// reason, and also takes the verification away from one that had it.
export const decideVerification = (admin: string, target: unknown, action: 'approve' | 'reject', input: { name?: unknown; domain?: unknown; note?: unknown }) => {
  assertAdmin(admin);
  const owner = typeof target === 'string' ? target : '';
  const workspace = isWalletAddress(owner) ? store.workspaces.get(owner) : undefined;
  if (!workspace) throw new HttpError(404, 'No encontramos esa empresa.');
  const previous = workspace.verification;
  const decidedAt = new Date().toISOString();

  if (action === 'approve') {
    const name = cleanText(input.name, 100);
    if (!name) throw new HttpError(400, 'Indicá el nombre comercial que verificaste.');
    // What buyers read is the published brand: verifying another name would leave it verifying nothing.
    if (workspace.brand && !sameName(workspace.brand.name, name)) {
      throw new HttpError(409, `La empresa publica su marca como «${workspace.brand.name}»: verificá ese nombre, o pedile que lo cambie antes.`);
    }
    const domain = cleanDomain(input.domain);
    change(workspace, {
      status: 'verified',
      ...(previous?.requestedAt ? { requestedAt: previous.requestedAt } : {}),
      ...(previous?.message ? { message: previous.message } : {}),
      decidedAt,
      by: admin,
      name,
      ...(domain ? { domain } : {})
    });
  } else {
    const note = cleanText(input.note, NOTE_LIMIT);
    if (!note) throw new HttpError(400, 'Escribí el motivo: la empresa lo lee para corregirlo.');
    change(workspace, {
      status: 'rejected',
      ...(previous?.requestedAt ? { requestedAt: previous.requestedAt } : {}),
      decidedAt,
      by: admin,
      note
    });
  }
  return verificationView(workspace);
};
