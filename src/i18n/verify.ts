// The public pages behind the printed QR codes: whoever scans a box in a store reads these, with no account and in
// whichever language they chose on the landing (see the locale middleware).
import type { Locale } from '@/lib/locale';

const es = {
  meta: {
    title: 'Verifire | Verificación de producto',
    description: 'Verificación pública de autenticidad y estado de un producto Verifire.',
    batchTitle: 'Verifire | Lote de productos',
    batchDescription: 'Verificación pública de un lote de productos Verifire.'
  },
  header: { network: 'Verificación pública', eyebrow: 'QR público del producto', batchEyebrow: 'QR público del lote' },
  issuer: { issuedBy: 'Emitido por', write: 'Escribir a la empresa', call: 'Llamar a la empresa', verified: 'Empresa verificada por Verifire', unverified: 'Empresa sin verificar' },
  photoAlt: 'Foto de {model}',
  product: {
    title: 'Verificá tu producto',
    lead: 'Escaneá el QR de la caja o ingresá el código público del producto.',
    claimedTitle: 'Producto original · garantía activa',
    sealedTitle: 'Producto original · sellado',
    // The issuer was not verified by Verifire: the code is real and unique, and that is all it says.
    registeredClaimedTitle: 'Producto registrado · garantía activa',
    registeredSealedTitle: 'Producto registrado · sellado',
    trust: {
      verified: 'Lo emitió una empresa verificada por Verifire.',
      verifiedSite: 'Sitio confirmado: {domain}.',
      unverified: 'La empresa que emitió este producto todavía no fue verificada por Verifire. El registro prueba que este código es único y no fue copiado, pero no que el producto sea original: confirmalo con la empresa.',
      unknown: 'Este producto no tiene una empresa emisora identificada. El registro prueba que este código es único y no fue copiado, pero no quién lo fabricó: confirmalo antes de comprar.'
    },
    transferred: 'Este producto fue transferido al usuario {to}. La garantía sigue vigente a su nombre.',
    claimed: 'La garantía de este producto ya fue activada por su comprador.',
    sealed: 'La caja está sellada en fábrica y la garantía todavía no fue activada.',
    notFoundTitle: 'No se pudo verificar',
    notFound: 'El token de producto no existe.',
    history: 'Historial del producto',
    rows: { product: 'Producto', model: 'Modelo', lot: 'Lote', destination: 'Destino', status: 'Estado', claimedAt: 'Garantía activada el', coverage: 'Cobertura hasta', owners: 'Dueños hasta hoy' },
    copy: {
      rejected: 'Alguien intentó activar este producto con su QR secreto cuando ya tenía dueño: la etiqueta pudo haber sido copiada. Si te lo ofrecen como nuevo, desconfiá.',
      distantScans: 'Este QR se verificó desde {first} y desde {second} en menos de 48 horas: puede haber copias de esta etiqueta. Confirmá con la empresa antes de comprar.'
    },
    status: { sealed: 'Sellado en fábrica', claimed: 'Garantía activa' }
  },
  scan: {
    hint: 'Escaneá el QR de afuera de la caja con la cámara, subí una foto o pegá una captura con',
    searching: 'QR leído. Buscando el producto...',
    secretQr: 'Ese es el QR secreto de adentro de la caja: sirve para activar la garantía desde tu panel de Verifire. Para verificar el producto escaneá el QR de afuera.',
    transferLink: 'Ese es un link de transferencia: abrilo desde tu panel de Verifire para aceptar el producto.',
    unknown: 'No reconocimos ese QR como un QR de Verifire.'
  },
  form: { label: 'O ingresá el código público del producto', placeholder: 'Ej. VF-7K3M9Q2A', submit: 'Verificar', note: 'No hace falta iniciar sesión: esta página solo muestra información pública del producto.' },
  batch: {
    unavailableTitle: 'Lote no disponible',
    lead: 'Escaneá el QR público del lote para ver sus productos.',
    title: 'Productos originales certificados',
    registeredTitle: 'Lote registrado en Verifire',
    summary: '{claimed} de {quantity} productos con la garantía activada. Este QR no revela códigos secretos.',
    notFound: 'El lote no existe.',
    rows: { model: 'Modelo', lot: 'Lote', destination: 'Destino', products: 'Productos' },
    status: { sealed: 'Sellado', claimed: 'Garantía activa' }
  }
};

type Messages = typeof es;

const en: Messages = {
  meta: {
    title: 'Verifire | Product verification',
    description: 'Public check of the authenticity and status of a Verifire product.',
    batchTitle: 'Verifire | Product batch',
    batchDescription: 'Public check of a batch of Verifire products.'
  },
  header: { network: 'Public verification', eyebrow: 'Public product QR', batchEyebrow: 'Public batch QR' },
  issuer: { issuedBy: 'Issued by', write: 'Write to the company', call: 'Call the company', verified: 'Company verified by Verifire', unverified: 'Unverified company' },
  photoAlt: 'Photo of {model}',
  product: {
    title: 'Check your product',
    lead: 'Scan the QR on the box or enter the public code of the product.',
    claimedTitle: 'Original product · warranty active',
    sealedTitle: 'Original product · sealed',
    registeredClaimedTitle: 'Registered product · warranty active',
    registeredSealedTitle: 'Registered product · sealed',
    trust: {
      verified: 'It was issued by a company verified by Verifire.',
      verifiedSite: 'Confirmed site: {domain}.',
      unverified: 'The company that issued this product has not been verified by Verifire yet. The record proves this code is unique and was not copied, but not that the product is original: confirm it with the company.',
      unknown: 'This product has no identified issuing company. The record proves this code is unique and was not copied, but not who made it: confirm it before buying.'
    },
    transferred: 'This product was transferred to user {to}. The warranty remains valid in their name.',
    claimed: 'The warranty of this product has already been activated by its buyer.',
    sealed: 'The box is sealed at the factory and the warranty has not been activated yet.',
    notFoundTitle: 'Could not be verified',
    notFound: 'That product token does not exist.',
    history: 'Product history',
    rows: { product: 'Product', model: 'Model', lot: 'Batch', destination: 'Destination', status: 'Status', claimedAt: 'Warranty activated on', coverage: 'Covered until', owners: 'Owners so far' },
    copy: {
      rejected: 'Someone tried to activate this product with its secret QR after it already had an owner: the label may have been copied. If it is offered to you as new, be careful.',
      distantScans: 'This QR was checked from {first} and from {second} within 48 hours: this label may have been copied. Confirm with the company before buying.'
    },
    status: { sealed: 'Sealed at the factory', claimed: 'Warranty active' }
  },
  scan: {
    hint: 'Scan the QR on the outside of the box with the camera, upload a photo or paste a screenshot with',
    searching: 'QR read. Looking for the product...',
    secretQr: 'That is the secret QR from inside the box: it activates the warranty from your Verifire panel. To check the product, scan the QR on the outside.',
    transferLink: 'That is a transfer link: open it from your Verifire panel to accept the product.',
    unknown: 'We did not recognise that QR as a Verifire QR.'
  },
  form: { label: 'Or enter the public code of the product', placeholder: 'e.g. VF-7K3M9Q2A', submit: 'Check', note: 'No account needed: this page only shows public information about the product.' },
  batch: {
    unavailableTitle: 'Batch unavailable',
    lead: 'Scan the public QR of the batch to see its products.',
    title: 'Certified original products',
    registeredTitle: 'Batch registered in Verifire',
    summary: '{claimed} of {quantity} products with the warranty activated. This QR reveals no secret codes.',
    notFound: 'That batch does not exist.',
    rows: { model: 'Model', lot: 'Batch', destination: 'Destination', products: 'Products' },
    status: { sealed: 'Sealed', claimed: 'Warranty active' }
  }
};

export type VerifyMessages = Messages;
export const getVerifyMessages = (locale: Locale = 'es'): Messages => (locale === 'en' ? en : es);
