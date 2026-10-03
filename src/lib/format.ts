const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const monthName = (date: Date) => (MONTHS[date.getMonth()] ?? '').replace(/^./, (letter) => letter.toUpperCase());

// "16 de Septiembre, 2026" / "16 September 2026"
export const formatDay = (iso: string, locale: 'es' | 'en' = 'es') => {
  const date = new Date(iso);
  return locale === 'en'
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
    : `${date.getDate()} de ${monthName(date)}, ${date.getFullYear()}`;
};

// "Septiembre 2027" / "September 2027"
export const formatMonth = (iso: string, locale: 'es' | 'en' = 'es') => {
  const date = new Date(iso);
  return locale === 'en'
    ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(date)
    : `${monthName(date)} ${date.getFullYear()}`;
};

// "16 de septiembre de 2026". Pages rendered on the server pass UTC, and the browser rewrites it in its own time zone
// (see LocalDates.astro).
export const formatLongDate = (iso: string, timeZone?: string, locale: 'es' | 'en' = 'es') =>
  new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'es-AR', { day: 'numeric', month: 'long', year: 'numeric', ...(timeZone ? { timeZone } : {}) });

// "16 sept 2026"
export const shortDate = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

// "4:05": minutes and seconds left until a moment, never below zero.
export const formatCountdown = (until: string, now: number) => {
  const seconds = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// "2 min 05 s" / "40 s": how long something that lasts minutes (a team invitation) still has.
export const formatTimeLeft = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
};

// "F6Yo…3Sx4": a Solana address short enough to read, in the two places that show one.
export const shortAddress = (address: string | undefined | null) => (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : 'desconocido');

// "1.234,5": an amount of tokens or USDC, as the company panels show it.
export const formatNumber = (value: number, maximumFractionDigits = 2, intl = 'es-AR') => value.toLocaleString(intl, { maximumFractionDigits });

export const plural = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm);
