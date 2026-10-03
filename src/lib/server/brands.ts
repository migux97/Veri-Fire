// The public face of a company: the name, logo and contact that its buyers see on each warranty. It is kept beside the
// company's wallet and can only be written with that wallet's signature (see workspaces.ts), so nobody else can publish
// under a brand or change it. What is written is exactly what the company chose to show: the tax id, the legal name and
// the address of its profile never reach this file.
//
// Nothing here says the company is who it claims to be: the name is what the company typed. The buyer is shown "issued
// by", not "verified".
import { createHash } from 'node:crypto';
import { BRAND_LIMITS, isEmail, isPhone, isPngDataUrl, isWebsite, slugify, type PublicBrand } from '../brand';
import { HttpError } from './errors';
import type { Issuer } from '../types';
import type { Brand, Product } from './store';
import { store } from './store';
import { isVerified } from './verification';

const text = (value: unknown, limit: number, message: string) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length > limit) throw new HttpError(400, message);
  return trimmed;
};

// Throws with a message for the person editing the profile when something is not valid.
export const parseBrand = (value: unknown): PublicBrand => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Los datos de la marca no son válidos.');
  const input = value as Record<string, unknown>;
  const name = text(input['name'], BRAND_LIMITS.name, 'El nombre comercial es demasiado largo.');
  if (!name) throw new HttpError(400, 'Ingresá el nombre comercial para mostrarlo a tus compradores.');
  const website = text(input['website'], BRAND_LIMITS.website, 'El sitio web es demasiado largo.');
  if (website && !isWebsite(website)) throw new HttpError(400, 'Revisá el sitio web: tiene que empezar con http:// o https://.');
  const supportEmail = text(input['supportEmail'], BRAND_LIMITS.email, 'El correo de soporte es demasiado largo.').toLowerCase();
  if (supportEmail && !isEmail(supportEmail)) throw new HttpError(400, 'Revisá el correo de soporte.');
  const supportPhone = text(input['supportPhone'], BRAND_LIMITS.phone, 'El teléfono de soporte es demasiado largo.');
  if (supportPhone && !isPhone(supportPhone)) throw new HttpError(400, 'Revisá el teléfono de soporte.');
  const description = text(input['description'], BRAND_LIMITS.description, 'La descripción es demasiado larga.');
  const logo = typeof input['logo'] === 'string' ? input['logo'].trim() : '';
  if (logo && !isPngDataUrl(logo)) throw new HttpError(413, 'El logo no es un PNG válido o pesa demasiado. Probá con uno más liviano.');
  return { name, website, description, supportEmail, supportPhone, logo };
};

const slugTaken = (slug: string, owner: string) =>
  [...store.workspaces.values()].some((workspace) => workspace.owner !== owner && workspace.brand?.slug === slug);

// The slug names the logo's public address, so it is chosen once and kept: renaming the company must not break the
// address buyers already have. Another company with the same name gets the end of its wallet added.
const slugFor = (owner: string, name: string, current?: Brand) => {
  if (current) return current.slug;
  const base = slugify(name);
  if (!slugTaken(base, owner)) return base;
  const withWallet = `${base.slice(0, 35)}-${owner.slice(-4).toLowerCase()}`;
  if (!slugTaken(withWallet, owner)) return withWallet;
  let counter = 2;
  while (slugTaken(`${withWallet}-${counter}`, owner)) counter += 1;
  return `${withWallet}-${counter}`;
};

export const buildBrand = (owner: string, input: unknown, current?: Brand): Brand => {
  const brand = parseBrand(input);
  return {
    slug: slugFor(owner, brand.name, current),
    name: brand.name,
    ...(brand.website ? { website: brand.website } : {}),
    ...(brand.description ? { description: brand.description } : {}),
    ...(brand.supportEmail ? { supportEmail: brand.supportEmail } : {}),
    ...(brand.supportPhone ? { supportPhone: brand.supportPhone } : {}),
    ...(brand.logo ? { logo: brand.logo, logoVersion: createHash('sha256').update(brand.logo).digest('hex').slice(0, 8) } : {}),
    updatedAt: new Date().toISOString()
  };
};

export const findBrandBySlug = (slug: string) => [...store.workspaces.values()].find((workspace) => workspace.brand?.slug === slug)?.brand;

// The PNG of a brand's logo, or null.
export const logoBytes = (brand: Brand) => {
  if (!brand.logo) return null;
  return Buffer.from(brand.logo.slice(brand.logo.indexOf(',') + 1), 'base64');
};

// Relative to the site, like the photos: the page works from whatever address it was opened at.
export const logoPathOf = (brand: Brand) =>
  brand.logo ? `/api/brand/${encodeURIComponent(brand.slug)}/logo.png?v=${brand.logoVersion ?? ''}` : null;

// Who issued a batch, as anyone may see it. It comes from the wallet that owns the purchase of the batch, and a purchase
// only gets an owner through a signed request, so a company cannot borrow another one's name by claiming its wallet.
//  - With a published brand: that brand, marked verified only if Verifire verified the company and it still shows the
//    verified name (see verification.ts).
//  - Without one: nothing, unless the company is verified, and then the name that was checked.
// This is what the public QR uses; `verified` is what tells a buyer whether "original" can be said.
export const publishedIssuerOf = (batchId: string | undefined): Issuer | null => {
  const purchase = batchId ? [...store.purchases.values()].find((candidate) => candidate.batchId === batchId) : undefined;
  const workspace = purchase?.owner ? store.workspaces.get(purchase.owner) : undefined;
  const verified = isVerified(workspace);
  const domain = verified ? workspace?.verification?.domain ?? null : null;
  const brand = workspace?.brand;
  if (brand) {
    return {
      name: brand.name,
      logoUrl: logoPathOf(brand),
      website: brand.website ?? (domain ? `https://${domain}` : null),
      email: brand.supportEmail ?? null,
      phone: brand.supportPhone ?? null,
      verified,
      domain
    };
  }
  if (verified && workspace?.verification?.name) {
    return {
      name: workspace.verification.name,
      logoUrl: null,
      website: domain ? `https://${domain}` : null,
      email: null,
      phone: null,
      verified: true,
      domain
    };
  }
  return null;
};

// Who issued a product, for its owner: the published brand, and without one the name and email the company set for
// support, which stay private to the owner.
export const issuerOf = (product: Product, support: { companyName: string; email: string } | undefined): Issuer | null => {
  const published = publishedIssuerOf(product.batchId);
  if (published) return { ...published, email: published.email ?? support?.email ?? null };
  return support ? { name: support.companyName, logoUrl: null, website: null, email: support.email, phone: null, verified: false, domain: null } : null;
};
