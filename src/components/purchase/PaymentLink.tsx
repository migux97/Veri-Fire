// The purchase's Solana Pay link, beside its QR: opens the wallet of this device or is copied and sent to whoever pays.
// It carries only the treasury, the amount, the token and the purchase's reference key, never the purchase id, so
// sharing it gives no access to the batch or its secret codes.
import { useState } from 'react';
import { useCompanyText } from '@/components/company/CompanyText';

interface PaymentLinkProps {
  uri: string;
}

export function PaymentLink({ uri }: PaymentLinkProps) {
  const t = useCompanyText();
  const text = t.purchase.link;
  const [status, setStatus] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setStatus({ text: text.copied, tone: 'success' });
    } catch {
      setStatus({ text: text.copyFailed, tone: 'error' });
    }
  };

  return (
    <div className="wallet-pay">
      <a className="button button-primary" href={uri}>
        <i className="fa-solid fa-wallet" aria-hidden="true" /> {text.open}
      </a>
      <button className="button button-secondary" type="button" onClick={() => void copy()}>
        <i className="fa-solid fa-link" aria-hidden="true" /> {text.copy}
      </button>
      <small className="field-hint">{text.hint}</small>
      {status && (
        <span className={`wallet-pay-status is-${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'}>
          {status.text}
        </span>
      )}
    </div>
  );
}
