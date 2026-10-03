// The brand a company shows to its buyers: built from its profile and its support settings, and published to the server
// with the wallet's signature (see brands.ts on the server). Nothing is published until the company asks for it, and
// from then on the brand is kept up to date whenever the profile or the support settings are saved.
import type { PublicBrand } from '../brand';
import { readAccountData, writeAccountData } from './account-data';
import { companyName, readCompanyProfile } from './company-profile';
import { readWarrantySettings } from './warranty-settings';
import { resolveWalletAddress } from './wallet';
import { syncWorkspace } from './workspace-sync';

// What this account knows about its published brand, kept with the account so every browser can show its state.
export interface PublishedBrand {
  slug: string;
  // Public address of the logo, or null when there is none.
  logoUrl: string | null;
  publishedAt: string;
  // What was published, in short, to tell whether the profile changed since.
  digest: string;
}

export type BrandStatus = 'unpublished' | 'current' | 'outdated';

// The public side of the profile. The support email is the one the company set for support, and there is none until it
// does: the contact email of the profile is internal and is not published on the company's behalf.
export const currentBrand = (): PublicBrand => {
  const profile = readCompanyProfile();
  return {
    name: companyName(),
    website: profile.website,
    description: profile.description,
    supportEmail: readWarrantySettings()?.email ?? '',
    supportPhone: profile.supportPhone,
    logo: profile.logo
  };
};

// Taking the brand down is written as a note of its own, not as a missing value: a missing value would not travel to the
// other browsers of the account, which would keep showing the brand as published.
export const readPublishedBrand = (): PublishedBrand | null => {
  const saved = readAccountData<PublishedBrand | { unpublished: true }>('brand-public');
  return saved && 'slug' in saved ? saved : null;
};

export const digestOf = async (brand: PublicBrand) => {
  const bytes = new TextEncoder().encode(JSON.stringify(brand));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash.slice(0, 6), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const brandStatus = async (): Promise<BrandStatus> => {
  const published = readPublishedBrand();
  if (!published) return 'unpublished';
  return published.digest === (await digestOf(currentBrand())) ? 'current' : 'outdated';
};

// Publishes (or updates) the brand. Answers what the server now holds.
export const publishBrand = async (): Promise<PublishedBrand | null> => {
  const brand = currentBrand();
  const owner = await resolveWalletAddress();
  const remote = await syncWorkspace(owner, { brand });
  if (!remote.brand) throw new Error('El servidor no confirmó la publicación. Probá de nuevo.');
  const published: PublishedBrand = {
    slug: remote.brand.slug,
    logoUrl: remote.brand.logoUrl,
    publishedAt: new Date().toISOString(),
    digest: await digestOf(brand)
  };
  writeAccountData('brand-public', published);
  return published;
};

// Takes the brand down: buyers go back to seeing only the name and email set for support.
export const unpublishBrand = async () => {
  const owner = await resolveWalletAddress();
  await syncWorkspace(owner, { brand: null });
  writeAccountData('brand-public', { unpublished: true });
};

// After the profile or the support settings change: a brand that was published stays in step with them.
export const refreshPublishedBrand = async () => {
  if (!readPublishedBrand()) return null;
  return publishBrand();
};
