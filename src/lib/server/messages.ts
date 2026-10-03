// Every message the API can show to a person, in one place. The same situation is reached from more than one side —
// the contract panics, the server checks its own state first, or the request itself is wrong — and all of them have to
// say the same thing.

export const messages = {
  alreadyClaimed: 'Este producto ya fue reclamado.',
  alreadyClaimedOnChain: 'Este producto ya fue reclamado en Solana.',
  notOwner: 'Solo el dueño actual puede transferir este producto.',
  linkClosed: 'Este link de transferencia ya no está vigente: el dueño lo canceló, generó otro o el producto ya cambió de dueño.',
  linkExpired: 'Este link de transferencia venció. Pedile al dueño que genere uno nuevo.',
  linkTooSoon: 'Ya generaste un link hace poco. Esperá unos minutos para pedir otro.',
  alreadyYours: 'Este producto ya es tuyo.',
  alreadyYoursShareLink: 'Este producto ya es tuyo. Para pasárselo a otra persona, compartile el link.',
  unknownProductOnChain: 'Este producto no está registrado en Solana.',
  qrNotFound: 'Este QR no corresponde a ningún producto registrado. Revisá que sea el QR de la etiqueta interna del empaque.',
  invalidSignature: 'La firma del QR no corresponde a este producto.',
  invalidOwner: 'Indica una dirección pública de Solana válida.',
  busy: 'Ya se está registrando un cambio de este producto en Solana. Esperá unos segundos.',
  tooManyRequests: 'Demasiados intentos seguidos. Esperá un minuto y volvé a probar.'
} as const;
