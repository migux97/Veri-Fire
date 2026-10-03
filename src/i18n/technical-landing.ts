import { getLocale } from './landing';

const es = {
  nav: { technology: 'Tecnología', how: 'Cómo funciona', cases: 'Casos de uso', docs: 'Docs/API', account: 'Mi cuenta', scan: 'Escanear / Validar QR' },
  account: {
    eyebrow: 'Tu espacio en Verifire', title: 'Tus productos, en tu cuenta.',
    lead: 'Activá garantías, consultá tus productos o gestioná los lotes de tu marca desde un mismo lugar.',
    loginTitle: '¿Ya tenés una cuenta?', loginText: 'Ingresá para acceder a tus garantías y continuar donde lo dejaste.', login: 'Ingresar',
    registerTitle: 'Empezá con Verifire', registerText: 'Creá una cuenta personal o empresarial para registrar tus compras o gestionar los productos de tu marca.', register: 'Crear cuenta',
    publicNote: 'Para consultar la procedencia de un producto no necesitás una cuenta.', verify: 'Verificar un QR'
  },
  hero: {
    eyebrow: 'Sistema de verificación criptográfica en Solana',
    title: 'Autenticidad física y garantías protegidas con doble factor on-chain.',
    lead: 'Anclamos números de serie a registros inmutables en Solana. Un QR público para auditar la procedencia en góndola y un código sellado para que el comprador active la garantía oficial y reclame su titularidad.',
    scan: 'Escanear y validar unidad', architecture: 'Ver arquitectura técnica',
    accountPrompt: 'Activá y gestioná tus garantías.',
    benefits: ['Doble factor QR', 'Bajo costo de red por serie', 'Verificación sin app obligatoria'],
    feeNote: 'Verifire paga las comisiones de red: el comprador no necesita SOL.'
  },
  audit: {
    title: 'Auditoría de unidad', demo: 'Demo interactiva', network: 'Solana Devnet', node: 'Verifire Core Node',
    publicQr: 'QR 1: Lectura Pública', secretQr: 'QR 2: Secreto de Garantía',
    publicText: 'El QR exterior de la caja permite consultar procedencia, lote y estado sin crear una cuenta.',
    secretText: 'El código bajo el precinto interno permite reclamar titularidad y activar la garantía una sola vez.',
    hash: 'Serial Hash', asset: 'Asset Code', ledger: 'Ledger State', state: 'Activo / Garantía 12 meses',
    note: 'Datos de ejemplo. Esta vista no realiza una consulta a la red.'
  },
  cases: {
    eyebrow: 'Trazabilidad en acción', title: 'Un protocolo. Cinco industrias.',
    lead: 'La procedencia se consulta. La garantía se reclama. Explorá cómo se aplica el doble factor en cada producto.',
    label: 'Casos de uso de Verifire', role: 'carrusel', position: 'Caso {current} de {total}', go: 'Ver caso: {industry}',
    navigation: 'Explorá las industrias', previous: 'Industria anterior', next: 'Industria siguiente',
    batch: 'Lote', active: 'Garantía activa', pending: 'En góndola (QR 2 pendiente)',
    public: 'QR 1 · Procedencia pública', secret: 'QR 2 · Activación privada',
    query: 'Solana RPC getAccountInfo: 200 OK', simulated: 'Consulta simulada',
    inspect: 'Cambio automático cada 4 s. Mantené el cursor o el dedo sobre la tarjeta para pausar.',
    paused: 'En pausa durante la inspección. Retirá el cursor, soltá el dedo o salí con Tab; si abriste el historial, cerralo.',
    examples: 'Casos ilustrativos; los datos y estados mostrados son de ejemplo.',
    history: 'Ver historial técnico de ejemplo', serial: 'Serie', destination: 'Destino', owner: 'Titular actual',
    specs: {
      asset: 'Asset Code', assetValue: 'Custom Asset (VF-{lot})',
      activation: 'Método de activación', activationValue: 'Firma biométrica / Passkey · Sin gas para el usuario',
      warranty: 'Lógica de garantía', warrantyValue: 'Programa Anchor en Solana · Transferible en mercado secundario'
    },
    industries: ['Relojería de Precisión', 'Perfumería Premium', 'Bodegas y Vinos de Exportación', 'Autopartes y Repuestos Críticos', 'Cosmética Premium'],
    descriptions: [
      'Un certificado de propiedad transferible conserva la procedencia y el historial de dueños en el mercado secundario.',
      'Un precinto con activación única ayuda a detectar frascos rellenados y desvíos al mercado gris antes de reclamar la garantía.',
      'Prueba de origen en el mostrador internacional: verificá bodega, cosecha y destino antes del descorche.',
      'Mecánicos y aseguradoras pueden consultar el origen registrado y el modelo de una pieza antes de instalarla.',
      'Consultá laboratorio, lote y destino antes de abrir el envase. El código sellado registra la compra una sola vez.'
    ]
  },
  docs: {
    eyebrow: 'Integración para fabricantes', title: 'Del empaque a tu infraestructura.',
    lead: 'Dos factores físicos. Un registro verificable. Integrá la emisión, la consulta pública y la activación en tu flujo de producción.',
    public: 'Consulta pública del producto por token; no requiere cuenta.',
    issue: 'Emisión administrativa. Requiere Authorization: Bearer y ADMIN_API_TOKEN.',
    claim: 'Prepara el mensaje de activación con activationKey y owner. El código sellado no se envía al servidor.',
    flow: 'Luego: firma local → /api/warranties/transaction → autorización de la wallet → /api/warranties.',
    architecture: 'Arquitectura del programa', reference: 'API RPC de Solana',
    example: 'Ejemplo de consulta pública', sample: 'Reemplazá el token por una serie registrada; las series de la demo no son registros reales.'
  }
};

const en: typeof es = {
  nav: { technology: 'Technology', how: 'How it works', cases: 'Use cases', docs: 'Docs/API', account: 'My account', scan: 'Scan / Validate QR' },
  account: {
    eyebrow: 'Your space in Verifire', title: 'Your products, in your account.',
    lead: 'Activate warranties, view your products, or manage your brand’s batches in one place.',
    loginTitle: 'Already have an account?', loginText: 'Sign in to access your warranties and pick up where you left off.', login: 'Sign in',
    registerTitle: 'Get started with Verifire', registerText: 'Create a personal or business account to register your purchases or manage your brand’s products.', register: 'Create account',
    publicNote: 'You don’t need an account to check a product’s provenance.', verify: 'Verify a QR code'
  },
  hero: {
    eyebrow: 'Cryptographic verification system on Solana', title: 'Physical authenticity and warranties protected by two on-chain factors.',
    lead: 'We anchor serial numbers to immutable records on Solana. A public QR code audits provenance on the shelf, while a sealed code lets the buyer activate the official warranty and claim ownership.',
    scan: 'Scan and validate a unit', architecture: 'Explore the architecture', benefits: ['Dual QR verification', 'Low network cost per serial', 'Verify without a mandatory app'], feeNote: 'Verifire pays the network fees: buyers need no SOL.',
    accountPrompt: 'Activate and manage your warranties.'
  },
  audit: {
    title: 'Unit audit', demo: 'Interactive demo', network: 'Solana Devnet', node: 'Verifire Core Node',
    publicQr: 'QR 1: Public Read', secretQr: 'QR 2: Warranty Secret', publicText: 'The QR on the outside of the box shows provenance, batch, and status without creating an account.',
    secretText: 'The code under the inner seal lets the buyer claim ownership and activate the warranty just once.',
    hash: 'Serial Hash', asset: 'Asset Code', ledger: 'Ledger State', state: 'Active / 12-month warranty', note: 'Sample data. This view does not query the network.'
  },
  cases: {
    eyebrow: 'Traceability in action', title: 'One protocol. Five industries.', lead: 'Provenance is queried. A warranty is claimed. Explore how dual QR verification works for each product.',
    label: 'Verifire use cases', role: 'carousel', position: 'Case {current} of {total}', go: 'View case: {industry}', batch: 'Batch', active: 'Warranty active', pending: 'On the shelf (QR 2 pending)',
    navigation: 'Explore the industries', previous: 'Previous industry', next: 'Next industry',
    public: 'QR 1 · Public provenance', secret: 'QR 2 · Private activation', query: 'Solana RPC getAccountInfo: 200 OK', simulated: 'Simulated query',
    inspect: 'Changes automatically every 4 s. Hover or hold the card to pause.',
    paused: 'Paused while inspecting. Move the pointer away, release your finger, or Tab out; close the history if open.',
    examples: 'Illustrative use cases; all displayed data and states are examples.',
    history: 'View sample technical history', serial: 'Serial', destination: 'Destination', owner: 'Current owner',
    specs: {
      asset: 'Asset Code', assetValue: 'Custom Asset (VF-{lot})',
      activation: 'Activation method', activationValue: 'Biometric signature / Passkey · No gas fees for the user',
      warranty: 'Warranty logic', warrantyValue: 'Anchor program on Solana · Transferable on the secondary market'
    },
    industries: ['Precision watchmaking', 'Premium perfume', 'Wineries & export wines', 'Critical auto parts & spares', 'Premium cosmetics'],
    descriptions: [
      'A transferable ownership certificate preserves provenance and the chain of owners in the secondary market.',
      'A seal with one-time activation helps detect refilled bottles and gray-market diversion before a warranty is claimed.',
      'Proof of origin at the international retail counter: verify the winery, vintage, and destination before opening the bottle.',
      'Mechanics and insurers can check a part’s registered origin and model before installation.',
      'Check the laboratory, batch, and destination before opening the container. The sealed code records the purchase just once.'
    ]
  },
  docs: {
    eyebrow: 'Manufacturer integration', title: 'From packaging to your infrastructure.', lead: 'Two physical factors. One verifiable record. Integrate issuance, public queries, and activation into your production workflow.',
    public: 'Public product lookup by token; no account required.', issue: 'Administrative issuance. Requires Authorization: Bearer and ADMIN_API_TOKEN.',
    claim: 'Prepares the activation message with activationKey and owner. The sealed code is not sent to the server.',
    flow: 'Then: local signature → /api/warranties/transaction → wallet authorization → /api/warranties.',
    architecture: 'Program architecture', reference: 'Solana RPC API', example: 'Public query example', sample: 'Replace the token with a registered serial; demo serials are not real records.'
  }
};

export type TechnicalLandingCopy = typeof es;
export const getTechnicalLandingCopy = (locale = 'es'): TechnicalLandingCopy => getLocale(locale) === 'en' ? en : es;
