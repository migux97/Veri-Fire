// The carousel of the home page when it shows real products: the latest verified ones whose owners chose to show them.
// Kept apart from the rest of the landing copy, which describes examples.
import type { Locale } from './landing';

const es = {
  live: 'En vivo',
  title: 'Últimos productos verificados',
  lead: 'Productos originales cuyo comprador eligió mostrarlos al activar su garantía. Cada uno se comprueba con su QR público.',
  eyebrow: 'Trazabilidad en acción',
  leadEmpty: 'Acá aparecen los productos originales cuyo comprador eligió mostrarlos al activar su garantía. Todavía no hay ninguno: mientras tanto, estos ejemplos muestran cómo se ve cada industria.',
  example: 'Ejemplo ilustrativo',
  examplesNote: 'Las tarjetas marcadas como ejemplo son ilustrativas: sus datos no son registros reales.',
  label: 'Últimos productos verificados',
  navigation: 'Últimas verificaciones',
  previous: 'Producto anterior',
  next: 'Producto siguiente',
  go: 'Ver {model}',
  chip: 'Producto verificado · {age}',
  specs: { issuer: 'Emitido por', destination: 'Destino', verifiedAt: 'Verificado el', record: 'Registro' },
  onChain: 'Programa en Solana',
  offChain: 'Registro de Verifire',
  unknownIssuer: 'Empresa sin marca publicada',
  verifiedIssuer: 'Empresa verificada por Verifire',
  public: 'QR 1 · Procedencia pública',
  secret: 'QR 2 · Activado por su dueño',
  inspect: 'Cambio automático cada 6 s. Mantené el cursor o el dedo sobre la tarjeta para pausar.',
  paused: 'En pausa durante la inspección.',
  note: 'Cada comprador decide, antes de activar su garantía, si su producto aparece acá, y puede quitarlo cuando quiera. Su cuenta nunca se muestra.',
  photoAlt: 'Foto de {model}'
};

const en: typeof es = {
  live: 'Live',
  title: 'Latest verified products',
  lead: 'Original products whose buyer chose to show them when activating their warranty. Each one can be checked with its public QR.',
  eyebrow: 'Traceability in action',
  leadEmpty: 'Original products whose buyer chose to show them when activating their warranty appear here. There are none yet: meanwhile, these examples show how each industry looks.',
  example: 'Illustrative example',
  examplesNote: 'Cards marked as examples are illustrative: their data are not real records.',
  label: 'Latest verified products',
  navigation: 'Latest verifications',
  previous: 'Previous product',
  next: 'Next product',
  go: 'Show {model}',
  chip: 'Verified product · {age}',
  specs: { issuer: 'Issued by', destination: 'Destination', verifiedAt: 'Verified on', record: 'Record' },
  onChain: 'Solana program',
  offChain: 'Verifire record',
  unknownIssuer: 'Company without a published brand',
  verifiedIssuer: 'Company verified by Verifire',
  public: 'QR 1 · Public provenance',
  secret: 'QR 2 · Activated by its owner',
  inspect: 'Changes every 6 s. Keep the cursor or your finger on the card to pause.',
  paused: 'Paused while you inspect it.',
  note: 'Each buyer decides, before activating their warranty, whether their product appears here, and can remove it whenever they want. Their account is never shown.',
  photoAlt: 'Photo of {model}'
};

export type ShowcaseCopy = typeof es;
export const getShowcaseCopy = (locale: Locale): ShowcaseCopy => (locale === 'en' ? en : es);
