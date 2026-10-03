// Keep complete phrases here: word order and punctuation belong to each language.
const es = {
  meta: {
    title: 'Verifire | Antipiratería con QR verificado en blockchain',
    description: 'Infraestructura antipiratería para marcas: un QR validado en un programa de Solana por producto, activación única y el historial de dueños, destinos y activaciones.'
  },
  common: { home: 'Verifire, inicio', buy: 'Comprar un lote', login: 'Ingresar', verify: 'Verificar', faq: 'Preguntas frecuentes' },
  nav: { sections: 'Secciones', history: 'Historial', how: 'Cómo funciona', brands: 'Para marcas', questions: 'Preguntas', verify: 'Verificar producto', register: 'Crear cuenta', dashboard: 'Ir a mi panel', language: 'Idioma' },
  hero: {
    eyebrow: 'Autenticidad, de origen a destino',
    benefits: ['Un QR por unidad', 'Activación única', 'Historial público'],
    journey: 'La confianza acompaña a tu producto.',
    journeyLabel: 'De la fábrica al próximo dueño',
    title: 'Cada producto original, verificable con un QR.',
    lead: 'Protegé tu marca y dale a cada comprador una forma simple de comprobar el origen, activar su garantía y conocer la historia de su producto.',
    stage: 'Etapa {current} de {total}', stageTitle: 'Etapa: {title}', previous: 'Etapa anterior', next: 'Etapa siguiente', history: 'Ver un historial'
  },
  trace: {
    eyebrow: 'Trazabilidad en acción',
    title: 'Elegí un producto y mirá su recorrido',
    lead: 'Ejemplos de cómo queda registrada una unidad en distintas industrias, desde la planta hasta su dueño actual.',
    history: 'Historial de {token}', token: 'Token', model: 'Modelo', destination: 'Destino', owner: 'Dueño actual', activations: 'Activaciones',
    verify: 'Verificar un código real', previous: 'Productos anteriores', next: 'Productos siguientes'
  },
  band: {
    title: 'Dos QR en cada producto', lead: 'Uno lo ve cualquiera en la góndola. El otro solo lo encuentra quien abre la caja.',
    publicTitle: 'Afuera, el QR público', publicText: 'Se escanea sin cuenta y muestra modelo, lote, destino y si la garantía ya fue activada. Sirve para controlar mercadería en el depósito o en la tienda.',
    secretTitle: 'Adentro, el QR secreto', secretText: 'Activa la garantía una única vez y deja al comprador como dueño. El código no se publica: el teléfono firma con él y solo viaja la firma.',
    verify: 'Probar la verificación pública', activation: 'Código de activación', activationHint: 'Usalo una vez para registrar tu compra', publicQr: 'QR público', secretQr: 'QR secreto', original: ['ORIGI', 'NAL']
  },
  audiences: {
    title: 'Quién usa Verifire', brands: 'Marcas y fabricantes',
    brandsText: 'Comprás lotes de etiquetas, las imprimís en tu línea de empaque y seguís desde un panel qué unidades se activaron y en qué mercado.',
    brandBenefits: ['Pago de cada lote en USDC con Solana Pay', 'Etiquetas con los dos QR, listas para imprimir', 'Activaciones de cada lote por destino'], brandLabel: ['TU', 'MARCA'],
    buyers: 'Compradores', buyersText: 'Escaneás el QR de adentro, confirmás con tu correo y la garantía queda a tu nombre. No necesitás criptomonedas ni pagar comisiones.',
    buyerBenefits: ['Cuenta creada con tu correo', 'Certificado público de cada garantía', 'Todas tus garantías en un mismo lugar'], activate: 'Activar mi garantía', createCompany: 'Registrar mi empresa'
  },
  safeguardsTitle: 'Por qué una etiqueta copiada no sirve',
  footer: {
    description: 'Infraestructura antipiratería para marcas, con cada producto registrado en Solana.', access: 'Accesos', warranties: 'Mis garantías', batches: 'Panel de lotes', sections: 'Secciones del sitio', history: 'Historial de un producto',
    verify: 'Verificá un producto', hint: 'Ingresá el código impreso junto al QR público.', placeholder: 'Ej. VF-7K3M9Q2A',
    tagline: 'Seguridad y reclamo de productos.'
  },
  profile: { title: 'Mi perfil', user: 'Usuario Verifire', noEmail: 'Correo no disponible', dark: 'Modo oscuro', company: 'Modo empresa', createCompany: 'Registrar una empresa', logout: 'Cerrar sesión' },
  showcase: {
    demo: 'Explorá los productos',
    credential: 'Identidad digital de producto',
    role: 'carrusel',
    label: 'Productos protegidos por Verifire',
    position: '{current} de {total}',
    counter: '{current} / {total}',
    tagline: 'Una etiqueta. Toda su historia.',
    headline: 'Original desde el primer día.',
    seal: 'Original verificable',
    sampleCaption: '{category} · Producto de ejemplo',
    previous: 'Imagen anterior',
    next: 'Imagen siguiente',
    pause: 'Pausar',
    play: 'Reproducir',
    pauseLabel: 'Pausar carrusel',
    playLabel: 'Reproducir carrusel'
  },
  artwork: {
    original: 'ORIGINAL',
    reserve: 'RESERVA',
    serum: 'SÉRUM',
    verified: 'Original verificado',
    lot: 'Lote {lot}'
  }
};

const en: typeof es = {
  meta: { title: 'Verifire | Anti-counterfeiting with blockchain-verified QR codes', description: 'Anti-counterfeiting infrastructure for brands: a QR code validated by a Solana program for every product, one-time activation, and a history of owners, destinations, and activations.' },
  common: { home: 'Verifire, home', buy: 'Buy a batch', login: 'Sign in', verify: 'Verify', faq: 'Frequently asked questions' },
  nav: { sections: 'Sections', history: 'History', how: 'How it works', brands: 'For brands', questions: 'Questions', verify: 'Verify a product', register: 'Create account', dashboard: 'Go to my dashboard', language: 'Language' },
  hero: {
    eyebrow: 'Authenticity, from origin to destination',
    benefits: ['One QR per unit', 'One-time activation', 'Public history'],
    journey: 'Trust follows your product.',
    journeyLabel: 'From the factory to the next owner',
    title: 'Every original product, verifiable with a QR code.',
    lead: 'Protect your brand and give every buyer a simple way to verify the origin, activate their warranty, and discover their product’s history.',
    stage: 'Stage {current} of {total}', stageTitle: 'Stage: {title}', previous: 'Previous stage', next: 'Next stage', history: 'Explore a history'
  },
  trace: {
    eyebrow: 'Traceability in action',
    title: 'Pick a product and follow its journey', lead: 'Examples of how a unit is recorded across different industries, from the factory to its current owner.',
    history: 'History of {token}', token: 'Token', model: 'Model', destination: 'Destination', owner: 'Current owner', activations: 'Activations', verify: 'Verify a real code', previous: 'Previous products', next: 'Next products'
  },
  band: {
    title: 'Two QR codes on every product', lead: 'Anyone can see one on the shelf. Only the person opening the box finds the other.',
    publicTitle: 'Outside: the public QR code', publicText: 'Scan without an account to see the model, batch, destination, and whether the warranty is already activated. Check goods in the warehouse or at the store.',
    secretTitle: 'Inside: the secret QR code', secretText: 'Activates the warranty just once and registers the buyer as the owner. The code stays private: the phone signs with it, and only the signature is sent.',
    verify: 'Try public verification', activation: 'Activation code', activationHint: 'Use it once to register your purchase', publicQr: 'Public QR', secretQr: 'Secret QR', original: ['ORIGI', 'NAL']
  },
  audiences: {
    title: 'Who uses Verifire', brands: 'Brands and manufacturers', brandsText: 'Buy batches of labels, print them on your packaging line, and track which units are activated and in which markets from one dashboard.',
    brandBenefits: ['Pay for each batch in USDC with Solana Pay', 'Ready-to-print labels with both QR codes', 'Batch activations by destination'], brandLabel: ['YOUR', 'BRAND'],
    buyers: 'Buyers', buyersText: 'Scan the QR code inside, confirm your email, and the warranty is registered in your name. No cryptocurrency or transaction fees required.',
    buyerBenefits: ['An account created with your email', 'A public certificate for every warranty', 'All your warranties in one place'], activate: 'Activate my warranty', createCompany: 'Register my company'
  },
  safeguardsTitle: 'Why a copied label does not work',
  footer: {
    description: 'Anti-counterfeiting infrastructure for brands, with every product registered on Solana.', access: 'Quick links', warranties: 'My warranties', batches: 'Batch dashboard', sections: 'Site sections', history: 'A product’s history', verify: 'Verify a product', hint: 'Enter the code printed next to the public QR code.', placeholder: 'e.g. VF-7K3M9Q2A',
    tagline: 'Product security and warranty claims.'
  },
  profile: { title: 'My profile', user: 'Verifire user', noEmail: 'Email unavailable', dark: 'Dark mode', company: 'Company workspace', createCompany: 'Register a company', logout: 'Sign out' },
  showcase: {
    demo: 'Explore the products',
    credential: 'Digital product identity',
    role: 'carousel', label: 'Products protected by Verifire', position: '{current} of {total}', counter: '{current} / {total}',
    tagline: 'One label. Its entire history.', headline: 'Original from day one.', seal: 'Verifiable original', sampleCaption: '{category} · Sample product',
    previous: 'Previous image', next: 'Next image', pause: 'Pause', play: 'Play', pauseLabel: 'Pause carousel', playLabel: 'Play carousel'
  },
  artwork: { original: 'ORIGINAL', reserve: 'RESERVE', serum: 'SERUM', verified: 'Verified original', lot: 'Batch {lot}' }
};

export type LandingMessages = typeof es;
export type Locale = 'es' | 'en';
const messages: Record<Locale, LandingMessages> = { es, en };

export function getLocale(locale = 'es'): Locale {
  return locale.toLowerCase().split('-')[0] === 'en' ? 'en' : 'es';
}

export function getLandingMessages(locale = 'es') {
  return messages[getLocale(locale)];
}

export function formatMessage(message: string, values: Record<string, string | number>) {
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) => String(values[key] ?? placeholder));
}
