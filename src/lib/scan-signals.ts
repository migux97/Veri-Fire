// Signs that a product's labels were copied, read from the product's own history. No browser or server: covered by
// tests/scan-signals.test.mjs.
//
// A public QR is just a printed code, so anyone can copy it. What a copy cannot do is be in two places at once or
// activate a product a second time, and that is what these signals look for:
// - rejected-claim: someone tried to activate the product with its secret QR after it already had an owner.
// - distant-scans: the public QR was checked from two different countries within COPY_WINDOW_MS.

export interface ScanEvent {
  kind: string;
  at: string;
  // Verified (public) checks: the visitor's country, ISO 3166-1 alpha-2, when the proxy reported one.
  country?: string;
}

export type CopySignal =
  | { kind: 'rejected-claim'; at: string }
  | { kind: 'distant-scans'; at: string; countries: [string, string] };

export const COPY_WINDOW_MS = 48 * 60 * 60 * 1000;

// A country code as the proxy sends it, or null. Cloudflare uses XX for unknown and T1 for Tor: neither is a place.
export const scanCountry = (value: string | null | undefined): string | null => {
  const code = value?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
};

// The latest signal, or null when nothing points to a copy.
export const copySignalOf = (events: readonly ScanEvent[]): CopySignal | null => {
  const signals: CopySignal[] = [];

  const rejected = events.filter((event) => event.kind === 'rejected').at(-1);
  if (rejected) signals.push({ kind: 'rejected-claim', at: rejected.at });

  const scans = events
    .filter((event): event is ScanEvent & { country: string } => event.kind === 'verified' && Boolean(event.country))
    .toSorted((first, second) => first.at.localeCompare(second.at));
  for (let index = scans.length - 1; index > 0; index -= 1) {
    const later = scans[index]!;
    const earlier = scans.slice(0, index).findLast((scan) =>
      scan.country !== later.country && Date.parse(later.at) - Date.parse(scan.at) <= COPY_WINDOW_MS);
    if (earlier) {
      signals.push({ kind: 'distant-scans', at: later.at, countries: [earlier.country, later.country] });
      break;
    }
  }

  return signals.toSorted((first, second) => second.at.localeCompare(first.at))[0] ?? null;
};

// How many people have owned the product: none while sealed, then the buyer who activated it plus one per transfer.
export const ownersCount = (claimed: boolean, events: readonly ScanEvent[]) =>
  claimed ? 1 + events.filter((event) => event.kind === 'transferred').length : 0;
