import type { ReactNode } from 'react';
import { getVerifyMessages } from '@/i18n/verify';
import { formatLongDate } from '@/lib/format';
import type { Locale } from '@/lib/locale';
import type { PublicProduct } from '@/lib/types';
import { DetailRows } from './DetailRows';

// Written in UTC on the server; LocalDates.astro rewrites it in the visitor's time zone.
function LocalDate({ iso, locale }: { iso: string; locale: Locale }) {
  return <time dateTime={iso} data-local-date="">{formatLongDate(iso, 'UTC', locale)}</time>;
}

interface ProductDetailsProps {
  product: PublicProduct;
  locale?: Locale;
}

export function ProductDetails({ product, locale = 'es' }: ProductDetailsProps) {
  const { rows, status } = getVerifyMessages(locale).product;
  return (
    <DetailRows
      tone={product.claimed ? 'active' : 'available'}
      rows={[
        [rows.product, product.token],
        [rows.model, product.model],
        [rows.lot, product.lot],
        [rows.destination, product.destination],
        [rows.status, product.status === 'CLAIMED_IN_WARRANTY' ? status.claimed : status.sealed],
        ...(product.claimed && product.claimedAt && product.warrantyUntil
          ? [
            [rows.claimedAt, <LocalDate iso={product.claimedAt} locale={locale} />],
            [rows.coverage, <LocalDate iso={product.warrantyUntil} locale={locale} />],
            [rows.owners, product.owners]
          ] satisfies [string, ReactNode][]
          : [])
      ]}
    />
  );
}
