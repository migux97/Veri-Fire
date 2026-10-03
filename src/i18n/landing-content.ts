import * as spanish from '@/components/landing/content';
import type { HeroSlide, SampleProduct } from '@/components/landing/content';
import { getLocale } from './landing';

const heroSlides: HeroSlide[] = [
  { stamp: ['SEA', 'LED'], title: 'Sealed at the factory', text: 'Each unit receives a token in the contract with its model, batch, and destination before leaving the factory.', detail: 'Batch 1043', status: 'Sealed' },
  { stamp: ['IN', 'TRANSIT'], title: 'Verifiable in any store', text: 'Anyone can scan the QR code outside the box, without an account, to check authenticity and the intended market.', detail: 'Destination Chile', status: 'In transit' },
  { stamp: ['ACTI', 'VATED'], title: 'Activated only once', text: 'The buyer scans the secret QR code inside and the warranty is registered in their name. A copy of that label cannot activate it again.', detail: 'Owner GBQK…7XHA', status: 'Activated' },
  { stamp: ['NEW', 'OWNER'], title: 'With its complete history', text: 'Every ownership change, destination, and activation is recorded in order and visible to anyone verifying the product.', detail: '2 registered owners', status: 'Transferred' }
];

const productCopy: Record<string, Pick<SampleProduct, 'category' | 'labelWord' | 'summary' | 'model' | 'destination'>> = {
  auriculares: { category: 'Headphones', labelWord: 'AUDIO', summary: 'The official warranty belongs only to the buyer of the original.', model: 'Pulse ANC', destination: 'Chile' },
  perfumes: { category: 'Perfumes', labelWord: 'SCENT', summary: 'Sealed bottles that cannot be refilled and resold as new.', model: 'Eau de Parfum No. 7', destination: 'Mexico' },
  relojes: { category: 'Watches', labelWord: 'WATCH', summary: 'Serial number and owner recorded from the day of purchase.', model: 'Smartwatch X9', destination: 'Argentina' },
  vinos: { category: 'Wines', labelWord: 'WINE', summary: 'Winery, vintage, and export market recorded for every bottle.', model: 'Malbec Reserve 2022', destination: 'United States' },
  repuestos: { category: 'Auto parts', labelWord: 'PART', summary: 'Auto parts with a verifiable origin at every repair shop.', model: 'F-220 brake pads', destination: 'Uruguay' },
  cosmetica: { category: 'Cosmetics', labelWord: 'SKIN', summary: 'Verify the batch and expiry date before opening the container.', model: 'Hyaluronic serum 30 ml', destination: 'Peru' }
};

const eventTitles: Record<string, string> = {
  'Registrado en el contrato': 'Registered in the contract',
  'Despachado a su destino': 'Shipped to its destination',
  'Verificado en tienda con el QR público': 'Verified in store with the public QR code',
  'Garantía activada con el QR secreto': 'Warranty activated with the secret QR code',
  'Cambió de dueño': 'Ownership transferred',
  'Activación rechazada: etiqueta copiada': 'Activation rejected: copied label',
  'Verificado por el importador': 'Verified by the importer',
  'Verificado en taller con el QR público': 'Verified at the repair shop with the public QR code'
};

const places: Record<string, string> = {
  'Planta Córdoba': 'Córdoba factory', 'Planta Pilar': 'Pilar factory', 'Planta Tierra del Fuego': 'Tierra del Fuego factory',
  'Planta Rafaela': 'Rafaela factory', 'Bodega Luján de Cuyo': 'Luján de Cuyo winery', 'Laboratorio Munro': 'Munro laboratory',
  'Guadalajara, México': 'Guadalajara, Mexico', 'Miami, Estados Unidos': 'Miami, United States', 'Lima, Perú': 'Lima, Peru',
  'Dueño GBQK…7XHA': 'Owner GBQK…7XHA', 'Dueño GD4M…Q2LP': 'Owner GD4M…Q2LP', 'Dueño GCX2…L9TE': 'Owner GCX2…L9TE',
  'Dueño GAHT…3MRW': 'Owner GAHT…3MRW', 'Dueño GBWN…8KDA': 'Owner GBWN…8KDA'
};

const sampleProducts: SampleProduct[] = spanish.sampleProducts.map((product) => ({
  ...product,
  ...productCopy[product.id],
  owner: product.owner === 'Sin dueño todavía' ? 'No owner yet' : product.owner,
  activations: product.activations === '0 de 1' ? '0 of 1' : '1 of 1',
  events: product.events.map((event) => ({ ...event, title: eventTitles[event.title] ?? event.title, place: places[event.place] ?? event.place }))
}));

const safeguards = [
  { icon: 'fa-solid fa-lock', title: 'Claimed only once', text: 'The contract marks the product as claimed on the first activation. Any copy of the QR code arrives too late.' },
  { icon: 'fa-solid fa-signature', title: 'The signature is tied to an account', text: 'The signed data includes the product and the claiming account. An intercepted signature cannot be used by anyone else.' },
  { icon: 'fa-solid fa-magnifying-glass', title: 'The record is public', text: 'Owners, destinations, and activations are recorded on Solana. Anyone can audit them without asking us for permission.' }
];

const faqs = [
  { question: 'What if someone copies the outside label?', answer: 'The public QR code only provides information: it shows the actual product status. A replica using the code of an already activated unit is exposed on the first scan.' },
  { question: 'Does the buyer need a wallet or cryptocurrency?', answer: 'No. They sign in with their email, a wallet is created automatically, and Verifire covers the network fee.' },
  { question: 'How do I pay for a batch of labels?', answer: 'In USDC with Solana Pay, from your Verifire wallet or any Solana wallet. Once payment is confirmed, each product in the batch is registered on Solana.' },
  { question: 'What is stored on the blockchain?', answer: 'The model, batch, destination, owner, and public activation key. The secret code never leaves the label: the phone signs with it, and only the signature is sent.' },
  { question: 'Can I see where my products are activated?', answer: 'Yes. The brand dashboard shows each batch, its activated units, and their destinations.' },
  { question: 'Does it work for products without a warranty?', answer: 'Yes. Activation also serves as a purchase record: it registers the owner even when there is no warranty.' }
];

const english = { heroSlides, sampleProducts, safeguards, faqs };

export function getLandingContent(locale = 'es') {
  return getLocale(locale) === 'en' ? english : spanish;
}
