// Every message the API can show to a person, in one place. The same situation is reached from more than one side —
// the contract panics, the server checks its own state first, or the request itself is wrong — and all of them have to
// say the same thing. The ones that name the network are read when used, so they follow CHAIN.
import { chainKind, chainLabel } from './chain-kind.ts';

export const messages = {
  alreadyClaimed: 'Este producto ya fue reclamado.',
  get alreadyClaimedOnChain() {
    return `Este producto ya fue reclamado en ${chainLabel()}.`;
  },
  notOwner: 'Solo el dueño actual puede transferir este producto.',
  linkClosed: 'Este link de transferencia ya no está vigente: el dueño lo canceló, generó otro o el producto ya cambió de dueño.',
  linkExpired: 'Este link de transferencia venció. Pedile al dueño que genere uno nuevo.',
  linkTooSoon: 'Ya generaste un link hace poco. Esperá unos minutos para pedir otro.',
  alreadyYours: 'Este producto ya es tuyo.',
  alreadyYoursShareLink: 'Este producto ya es tuyo. Para pasárselo a otra persona, compartile el link.',
  get unknownProductOnChain() {
    return `Este producto no está registrado en ${chainLabel()}.`;
  },
  qrNotFound: 'Este QR no corresponde a ningún producto registrado. Revisá que sea el QR de la etiqueta interna del empaque.',
  invalidSignature: 'La firma del QR no corresponde a este producto.',
  get invalidOwner() {
    return chainKind() === 'solana' ? 'Indica una dirección pública de Solana válida.' : 'Indica una dirección pública Stellar válida (G...).';
  },
  get busy() {
    return `Ya se está registrando un cambio de este producto en ${chainLabel()}. Esperá unos segundos.`;
  },
  tooManyRequests: 'Demasiados intentos seguidos. Esperá un minuto y volvé a probar.'
} as const;
