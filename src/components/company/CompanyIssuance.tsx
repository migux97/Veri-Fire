import { useEffect, useState } from 'react';
import { PurchaseForm } from '@/components/purchase/PurchaseForm';
import type { Locale } from '@/lib/locale';
import type { CountryOption } from '@/lib/types';
import { Operations } from './CompanyOperations';
import { CompanyTextProvider, useCompanyText } from './CompanyText';

type Mode = 'now' | 'batch' | 'payment';

const modes: { id: Mode; icon: string }[] = [
  { id: 'now', icon: 'fa-bolt' },
  { id: 'batch', icon: 'fa-calendar-plus' },
  { id: 'payment', icon: 'fa-coins' }
];

// Other parts of the panel ask for a mode (the overview's "Programar pago") with this event before opening #generate.
export const ISSUANCE_MODE_EVENT = 'verifire:issuance-mode';

interface CompanyIssuanceProps {
  countries: CountryOption[];
  pricePerToken: string;
  locale?: Locale | undefined;
}

export function CompanyIssuance({ locale, ...props }: CompanyIssuanceProps) {
  return (
    <CompanyTextProvider locale={locale}>
      <Issuance {...props} />
    </CompanyTextProvider>
  );
}

function Issuance({ countries, pricePerToken }: Omit<CompanyIssuanceProps, 'locale'>) {
  const t = useCompanyText();
  const text = t.issuance;
  const [mode, setMode] = useState<Mode>('now');

  useEffect(() => {
    const choose = (event: Event) => {
      const requested = (event as CustomEvent<Mode>).detail;
      if (modes.some((item) => item.id === requested)) setMode(requested);
    };
    window.addEventListener(ISSUANCE_MODE_EVENT, choose);
    return () => window.removeEventListener(ISSUANCE_MODE_EVENT, choose);
  }, []);

  return (
    <div className="company-issuance">
      <header className="issuance-heading">
        <span className="company-eyebrow">{text.eyebrow}</span>
        <h2>{text.title}</h2>
        <p>{text.lead}</p>
      </header>
      <div className="issuance-modes" role="group" aria-label={text.modesLabel}>
        {modes.map((item) => (
          <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>
            <span className="issuance-mode-icon" aria-hidden="true">
              <i className={`fa-solid ${item.icon}`} />
            </span>
            <span>
              <strong>{text.modes[item.id].title}</strong>
              <small>{text.modes[item.id].detail}</small>
            </span>
          </button>
        ))}
      </div>
      <div hidden={mode !== 'now'} className="issuance-immediate">
        <article className="company-card company-generation-form">
          <div className="issuance-section-title">
            <span>01</span>
            <div>
              <h2>{text.batchData}</h2>
              <p>{text.batchDataLead}</p>
            </div>
          </div>
          <PurchaseForm pricePerToken={pricePerToken} countries={countries} batchesHref="#batches" embedded />
        </article>
        <aside className="company-card issuance-payment-info">
          <span className="company-eyebrow">{text.infoEyebrow}</span>
          <h3>{text.infoTitle}</h3>
          <dl>
            <div>
              <dt>{text.allowed}</dt>
              <dd>{text.allowedValue}</dd>
            </div>
            <div>
              <dt>{text.currency}</dt>
              <dd>USDC</dd>
            </div>
            <div>
              <dt>{text.method}</dt>
              <dd>Solana Pay</dd>
            </div>
          </dl>
          <p>{text.infoAmount}</p>
          <p>{text.infoBatches}</p>
        </aside>
      </div>
      <div hidden={mode === 'now'}>
        <Operations mode={mode === 'payment' ? 'payment' : 'batch'} />
      </div>
    </div>
  );
}
