import { IssuanceConfigurator } from './IssuanceConfigurator';
import { PhotoPicker } from './PhotoPicker';
// Company purchase: pay a batch of tokens in USDC with Solana Pay. Once the payment is confirmed the batch, its labels and its
// activation counters live in Mis lotes; this form only creates the purchase and follows its payment.
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { useCompanyText } from '@/components/company/CompanyText';
import { Icon } from '@/components/ui/Icon';
import { PaymentWarning } from '@/components/ui/PaymentWarning';
import type { Message } from '@/components/ui/StatusMessage';
import { Toast } from '@/components/ui/Toast';
import { PaymentLink } from './PaymentLink';
import { createPurchase, fetchPurchase, migrateLegacyPurchase, savePurchase } from '@/lib/client/purchases';
import { saveBatchPhoto } from '@/lib/client/photo';
import { supportForNewBatch } from '@/lib/client/warranty-settings';
import { userSession } from '@/lib/client/session';
import { errorMessage } from '@/lib/errors';
import type { CountryOption, CreatedPurchase } from '@/lib/types';

const POLL_MS = 4000;

interface PurchaseFormProps {
  countries: CountryOption[];
  batchesHref?: string;
  embedded?: boolean;
  pricePerToken?: string;
}

// LATAM first, the rest in alphabetical order.
const groupByRegion = (countries: CountryOption[]) => {
  const regions = new Map<string, CountryOption[]>();
  countries.forEach((country) => regions.set(country.region, [...(regions.get(country.region) ?? []), country]));
  return [...regions.entries()].sort(([first], [second]) => (first === 'LATAM' ? -1 : second === 'LATAM' ? 1 : first.localeCompare(second, 'es')));
};

export function PurchaseForm({ countries, batchesHref = '/batches', embedded = false, pricePerToken }: PurchaseFormProps) {
  const t = useCompanyText();
  const [message, setMessage] = useState<Message | null>(null);
  const [payment, setPayment] = useState<CreatedPurchase | null>(null);
  const [paymentStatus, setPaymentStatus] = useState(t.purchase.waiting);
  const [submitting, setSubmitting] = useState(false);
  const [batchReady, setBatchReady] = useState(false);
  const [country, setCountry] = useState('');
  // The photo of the batch of the simple form; the configurator keeps its own.
  const [photo, setPhoto] = useState('');
  const purchaseId = useRef('');
  const pollTimer = useRef<number | undefined>(undefined);
  // Set when the form closes: a poll that was mid-request must not schedule the next one.
  const stopped = useRef(false);
  const regions = useMemo(() => groupByRegion(countries), [countries]);
  // Printed on the labels ("Argentina · LATAM"), as the server composes it.
  const destination = countries.find((option) => option.code === country)?.destination;

  useEffect(() => {
    if (userSession.isActive()) migrateLegacyPurchase();
    return () => {
      stopped.current = true;
      window.clearTimeout(pollTimer.current);
    };
  }, []);

  const pollPurchase = async () => {
    const polled = purchaseId.current;
    pollTimer.current = undefined;
    try {
      const data = await fetchPurchase(polled);
      // Ignore an answer for a purchase that was already replaced by a newer one.
      if (polled !== purchaseId.current) return;
      if (data.succeeded && data.purchase.batchId) {
        purchaseId.current = '';
        setPayment(null);
        setBatchReady(true);
        // Inside the company panel the notifications already announce the payment and the batch.
        if (!embedded) setMessage({ text: t.purchase.confirmed(data.purchase.batchId), tone: 'success' });
        return;
      }
      setPaymentStatus(data.succeeded ? t.purchase.preparing : t.purchase.status(data.status));
    } catch (error) {
      if (polled !== purchaseId.current) return;
      setPaymentStatus(errorMessage(error));
    }
    if (!stopped.current) pollTimer.current = window.setTimeout(() => void pollPurchase(), POLL_MS);
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const chosen = String(formData.get('country') ?? '');
    setSubmitting(true);
    window.clearTimeout(pollTimer.current);
    purchaseId.current = '';
    setBatchReady(false);
    setMessage({ text: t.purchase.creating, tone: 'info' });
    try {
      const support = supportForNewBatch();
      const purchase = await createPurchase(
        {
          ...(support ? { support } : {}),
          model: String(formData.get('model') ?? '').trim(),
          lot: String(formData.get('lot') ?? '').trim(),
          country: chosen,
          quantity: Number(formData.get('quantity')),
          ...(formData.get('configuration') ? { configuration: JSON.parse(String(formData.get('configuration'))) } : {})
        },
        t.purchase.createFailed
      );

      // Saved right away: the purchase is already in Mis lotes, even if this page is closed before paying.
      savePurchase(purchase.purchaseId);
      // The photo of the batch, if one was chosen. The purchase stands without it: it can be added from Mis lotes.
      const photo = String(formData.get('photo') ?? '');
      let photoFailed = false;
      if (photo) {
        try {
          await saveBatchPhoto(purchase.purchaseId, photo, t.photo.uploadFailed);
        } catch {
          photoFailed = true;
        }
      }
      purchaseId.current = purchase.purchaseId;
      form.reset();
      setCountry('');
      setPhoto('');
      setMessage(photoFailed ? { text: t.photo.uploadFailed, tone: 'error' } : null);
      setPayment(purchase);
      setPaymentStatus(t.purchase.waiting);
      void pollPurchase();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {embedded ? (
        !(payment || batchReady) && (
          <IssuanceConfigurator pricePerToken={pricePerToken} countries={countries} submitting={submitting} onSubmit={(event) => void handleSubmit(event)} />
        )
      ) : (
        <form className="claim-form" hidden={embedded && (Boolean(payment) || batchReady)} onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="product-model">Modelo del producto</label>
          <input id="product-model" name="model" placeholder="Ej. Zapatilla Runner X" maxLength={120} required />
          <label htmlFor="product-lot">Lote de fabricación</label>
          <input id="product-lot" name="lot" placeholder="Ej. 1043" maxLength={60} required />
          <label htmlFor="product-country">País de destino</label>
          <select
            id="product-country"
            name="country"
            aria-describedby="destination-preview"
            required
            value={country}
            onChange={(event) => setCountry(event.currentTarget.value)}
          >
            <option value="">Elegí el país de destino</option>
            {regions.map(([region, regionCountries]) => (
              <optgroup key={region} label={region}>
                {regionCountries.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p id="destination-preview" className="field-hint">
            {destination ? `En las etiquetas va a figurar: ${destination}` : 'La región se completa sola según el país que elijas.'}
          </p>
          <label htmlFor="token-quantity">Cantidad de tokens</label>
          <input id="token-quantity" name="quantity" type="number" min={1} max={500} defaultValue={3} required />
          <PhotoPicker value={photo} onChange={setPhoto} />
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Preparando pago…' : 'Generar lote y pagar'}
          </button>
        </form>
      )}

      {payment && (
        <div className="verify-details is-available">
          <strong>{t.purchase.payTitle(payment.amount, payment.asset || 'USDC', payment.quantity)}</strong>
          <span>{t.purchase.payNote}</span>
          <PaymentWarning as="span" text={t.purchase.warning} />
          {payment.qr && <img src={payment.qr} alt={t.purchase.qrAlt} width={240} height={240} />}
          {payment.uri && <PaymentLink uri={payment.uri} />}
          <span role="status">{paymentStatus}</span>
        </div>
      )}
      {embedded && (payment || batchReady) && (
        <div className="company-payment-actions">
          {batchReady ? <p role="status">{t.purchase.ready}</p> : <p>{t.purchase.leaveNote}</p>}
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              window.clearTimeout(pollTimer.current);
              purchaseId.current = '';
              setPayment(null);
              setBatchReady(false);
              setMessage(null);
            }}
          >
            {t.purchase.another}
          </button>
          {(payment || batchReady) && (
            <a className="button button-secondary" href={batchesHref}>
              {t.purchase.seeBatches}
            </a>
          )}
        </div>
      )}
      <Toast message={message} onClose={() => setMessage(null)} closeLabel={t.notifications.close} />
      {!embedded && (
        <a className="button button-secondary" href={batchesHref} hidden={!batchReady}>
          <Icon name="fa-solid fa-boxes-stacked" /> {t.purchase.myBatches}
        </a>
      )}
    </>
  );
}
