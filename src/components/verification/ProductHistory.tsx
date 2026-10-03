import { Icon } from '@/components/ui/Icon';
import { LedgerLink } from '@/components/ui/LedgerLink';
import { fillIn, getConsumerMessages, type ConsumerLocale } from '@/i18n/consumer';
import { formatLongDate } from '@/lib/format';
import type { HistoryEvent, HistoryKind } from '@/lib/types';

const ICONS: Record<HistoryKind, string> = {
  minted: 'fa-solid fa-file-signature',
  shipped: 'fa-solid fa-truck',
  verified: 'fa-solid fa-qrcode',
  activated: 'fa-solid fa-key',
  rejected: 'fa-solid fa-ban',
  transferred: 'fa-solid fa-right-left'
};

interface ProductHistoryProps {
  events: HistoryEvent[];
  // Server-rendered pages pass UTC and add LocalDates.astro, which rewrites the dates in the visitor's time zone.
  timeZone?: string;
  locale?: ConsumerLocale;
}

// Every moment of a product, oldest first. Events backed by a Solana transaction link to it.
export function ProductHistory({ events, timeZone, locale = 'es' }: ProductHistoryProps) {
  const labels = getConsumerMessages(locale).history;

  const titleOf = (event: HistoryEvent) => {
    // A product not registered yet was only issued: it has no contract record to show.
    if (event.kind === 'minted' && !event.txUrl) return labels.labelIssued;
    if (event.kind === 'transferred' && event.to) return fillIn(labels.transferredTo, { to: event.to });
    return labels[event.kind];
  };

  return (
    <ol className="history">
      {events.map((event, index) => (
        <li key={`${event.kind}-${event.at}-${index}`} className={`history-event is-${event.kind}`}>
          <span className="history-icon"><Icon name={ICONS[event.kind]} /></span>
          <div className="history-body">
            <strong>{titleOf(event)}</strong>
            {event.detail && <span>{event.detail}</span>}
            <time className="history-date" dateTime={event.at} data-local-date="">{formatLongDate(event.at, timeZone, locale)}</time>
            {event.txUrl && <LedgerLink href={event.txUrl} title={labels.linkTitle}>{labels.link}</LedgerLink>}
          </div>
        </li>
      ))}
    </ol>
  );
}
