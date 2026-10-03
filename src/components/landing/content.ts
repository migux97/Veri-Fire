// Copy and sample data of the landing page. The products and their histories are examples, not records.

export interface HeroSlide {
  // The stamp word, split over two lines like a printed label.
  stamp: [string, string];
  title: string;
  text: string;
  detail: string;
  // Rubber stamp over the box illustration.
  status: string;
}

// The life of one product, in order.
export const heroSlides: HeroSlide[] = [
  {
    stamp: ['SELLA', 'DO'],
    title: 'Sellado en fábrica',
    text: 'Cada unidad recibe un token en el contrato con su modelo, lote y destino antes de salir de la planta.',
    detail: 'Lote 1043',
    status: 'Sellado'
  },
  {
    stamp: ['EN', 'RUTA'],
    title: 'Verificable en cualquier tienda',
    text: 'El QR de afuera de la caja lo escanea cualquiera, sin cuenta, y muestra si el producto es original y a qué mercado iba.',
    detail: 'Destino Chile',
    status: 'En ruta'
  },
  {
    stamp: ['ACTI', 'VADO'],
    title: 'Activado una sola vez',
    text: 'El comprador escanea el QR secreto de adentro y la garantía queda a su nombre. Una copia de esa etiqueta ya no activa nada.',
    detail: 'Dueño GBQK…7XHA',
    status: 'Activado'
  },
  {
    stamp: ['NUEVO', 'DUEÑO'],
    title: 'Con todo su historial',
    text: 'Cada cambio de dueño, cada destino y cada activación quedan registrados en orden y a la vista de quien verifique.',
    detail: '2 dueños registrados',
    status: 'Transferido'
  }
];


export type TraceKind = 'minted' | 'shipped' | 'verified' | 'activated' | 'transferred' | 'rejected';

export interface TraceEvent {
  kind: TraceKind;
  title: string;
  place: string;
  date: string;
}

export interface SampleProduct {
  id: string;
  category: string;
  // Word printed on the box label of the illustration.
  labelWord: string;
  labelColor: string;
  summary: string;
  token: string;
  model: string;
  lot: string;
  destination: string;
  owner: string;
  activations: string;
  events: TraceEvent[];
}


export const sampleProducts: SampleProduct[] = [
  {
    id: 'auriculares',
    category: 'Auriculares',
    labelWord: 'AUDIO',
    labelColor: '#1f5fd6',
    summary: 'La garantía oficial queda solo para quien compró el original.',
    token: 'VF-1043-018',
    model: 'Pulse ANC',
    lot: '1043',
    destination: 'Chile',
    owner: 'GD4M…Q2LP',
    activations: '1 de 1',
    events: [
      { kind: 'minted', title: 'Registrado en el contrato', place: 'Planta Córdoba', date: '2026-03-03' },
      { kind: 'shipped', title: 'Despachado a su destino', place: 'Santiago, Chile', date: '2026-03-12' },
      { kind: 'verified', title: 'Verificado en tienda con el QR público', place: 'Santiago, Chile', date: '2026-03-28' },
      { kind: 'activated', title: 'Garantía activada con el QR secreto', place: 'Dueño GBQK…7XHA', date: '2026-04-02' },
      { kind: 'transferred', title: 'Cambió de dueño', place: 'Dueño GD4M…Q2LP', date: '2026-07-19' }
    ]
  },
  {
    id: 'perfumes',
    category: 'Perfumes',
    labelWord: 'AROMA',
    labelColor: '#15924a',
    summary: 'Frascos sellados que nadie puede rellenar y revender como nuevos.',
    token: 'VF-0877-240',
    model: 'Eau de Parfum Nº 7',
    lot: '0877',
    destination: 'México',
    owner: 'GCX2…L9TE',
    activations: '1 de 1',
    events: [
      { kind: 'minted', title: 'Registrado en el contrato', place: 'Planta Pilar', date: '2026-02-09' },
      { kind: 'shipped', title: 'Despachado a su destino', place: 'Guadalajara, México', date: '2026-02-20' },
      { kind: 'activated', title: 'Garantía activada con el QR secreto', place: 'Dueño GCX2…L9TE', date: '2026-03-14' },
      { kind: 'rejected', title: 'Activación rechazada: etiqueta copiada', place: 'Guadalajara, México', date: '2026-03-30' }
    ]
  },
  {
    id: 'relojes',
    category: 'Relojes',
    labelWord: 'RELOJ',
    labelColor: '#e3261f',
    summary: 'Número de serie y dueño registrados desde el día de la venta.',
    token: 'VF-1101-004',
    model: 'Smartwatch X9',
    lot: '1101',
    destination: 'Argentina',
    owner: 'GAHT…3MRW',
    activations: '1 de 1',
    events: [
      { kind: 'minted', title: 'Registrado en el contrato', place: 'Planta Tierra del Fuego', date: '2026-04-15' },
      { kind: 'shipped', title: 'Despachado a su destino', place: 'Rosario, Argentina', date: '2026-04-22' },
      { kind: 'verified', title: 'Verificado en tienda con el QR público', place: 'Rosario, Argentina', date: '2026-05-06' },
      { kind: 'activated', title: 'Garantía activada con el QR secreto', place: 'Dueño GAHT…3MRW', date: '2026-05-06' }
    ]
  },
  {
    id: 'vinos',
    category: 'Vinos',
    labelWord: 'VINOS',
    labelColor: '#8f2fb8',
    summary: 'Bodega, cosecha y mercado de exportación en cada botella.',
    token: 'VF-0922-311',
    model: 'Malbec Reserva 2022',
    lot: '0922',
    destination: 'Estados Unidos',
    owner: 'Sin dueño todavía',
    activations: '0 de 1',
    events: [
      { kind: 'minted', title: 'Registrado en el contrato', place: 'Bodega Luján de Cuyo', date: '2026-06-02' },
      { kind: 'shipped', title: 'Despachado a su destino', place: 'Miami, Estados Unidos', date: '2026-06-18' },
      { kind: 'verified', title: 'Verificado por el importador', place: 'Miami, Estados Unidos', date: '2026-07-09' }
    ]
  },
  {
    id: 'repuestos',
    category: 'Repuestos',
    labelWord: 'PIEZA',
    labelColor: '#ee7a12',
    summary: 'Autopartes con origen comprobable en el mostrador de cada taller.',
    token: 'VF-0655-102',
    model: 'Pastillas de freno F-220',
    lot: '0655',
    destination: 'Uruguay',
    owner: 'GBWN…8KDA',
    activations: '1 de 1',
    events: [
      { kind: 'minted', title: 'Registrado en el contrato', place: 'Planta Rafaela', date: '2026-01-11' },
      { kind: 'shipped', title: 'Despachado a su destino', place: 'Montevideo, Uruguay', date: '2026-01-25' },
      { kind: 'verified', title: 'Verificado en taller con el QR público', place: 'Montevideo, Uruguay', date: '2026-02-03' },
      { kind: 'activated', title: 'Garantía activada con el QR secreto', place: 'Dueño GBWN…8KDA', date: '2026-02-03' }
    ]
  },
  {
    id: 'cosmetica',
    category: 'Cosmética',
    labelWord: 'PIEL',
    labelColor: '#0f8a8a',
    summary: 'Lote y vencimiento verificables antes de abrir el envase.',
    token: 'VF-1210-057',
    model: 'Sérum hialurónico 30 ml',
    lot: '1210',
    destination: 'Perú',
    owner: 'Sin dueño todavía',
    activations: '0 de 1',
    events: [
      { kind: 'minted', title: 'Registrado en el contrato', place: 'Laboratorio Munro', date: '2026-08-20' },
      { kind: 'shipped', title: 'Despachado a su destino', place: 'Lima, Perú', date: '2026-09-01' }
    ]
  }
];

export const safeguards = [
  {
    icon: 'fa-solid fa-lock',
    title: 'Se reclama una sola vez',
    text: 'El contrato marca el producto como reclamado en la primera activación. Cualquier copia del QR llega tarde.'
  },
  {
    icon: 'fa-solid fa-signature',
    title: 'La firma va atada a una cuenta',
    text: 'Lo que se firma incluye el producto y la cuenta que lo reclama. Una firma interceptada no le sirve a nadie más.'
  },
  {
    icon: 'fa-solid fa-magnifying-glass',
    title: 'El registro es público',
    text: 'Dueños, destinos y activaciones quedan en Solana. Cualquiera puede auditarlos sin pedirnos permiso.'
  }
];

export const faqs = [
  {
    question: '¿Qué pasa si alguien copia la etiqueta de afuera?',
    answer:
      'El QR público solo informa: muestra el estado real del producto. Una réplica que lleva el código de una unidad ya activada se delata en el primer escaneo.'
  },
  {
    question: '¿El comprador necesita una wallet o criptomonedas?',
    answer: 'No. Entra con su correo, la wallet se crea sola y la comisión de red la paga Verifire.'
  },
  {
    question: '¿Cómo se paga un lote de etiquetas?',
    answer: 'En USDC con Solana Pay, desde tu wallet de Verifire o cualquier wallet de Solana. Cuando se confirma el pago, cada producto del lote queda registrado en Solana.'
  },
  {
    question: '¿Qué se guarda en la blockchain?',
    answer:
      'Modelo, lote, destino, dueño y la clave pública de activación. El código secreto nunca sale de la etiqueta: el teléfono firma con él y solo viaja la firma.'
  },
  {
    question: '¿Puedo ver dónde se activan mis productos?',
    answer: 'Sí. El panel de la marca muestra cada lote con sus unidades activadas y el destino de cada una.'
  },
  {
    question: '¿Sirve para productos sin garantía?',
    answer: 'Sí. La activación también funciona como registro de compra: deja al dueño asentado aunque no haya una garantía de por medio.'
  }
];
