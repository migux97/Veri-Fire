// How to pay a purchase besides its QR: the Solana Pay link (opens the wallet of this device, or is sent to whoever pays)
// and a transfer made by hand to the treasury for the exact amount. The link carries only the treasury, the amount, the
// token and the purchase's reference key; neither shares the purchase id, so they give no access to the batch or its codes.
import { useState } from 'react';
import { useCompanyText } from '@/components/company/CompanyText';

interface PaymentLinkProps {
  uri: string;
  // The treasury and the exact amount for a transfer by hand. Missing on purchases the server has not checked yet.
  recipient?: string | null | undefined;
  transferAmount?: string | null | undefined;
}

type Status = { text: string; tone: 'success' | 'error' } | null;

export function PaymentLink({ uri, recipient, transferAmount }: PaymentLinkProps) {
  const t = useCompanyText();
  const text = t.purchase.link;
  const [status, setStatus] = useState<Status>(null);

  const copy = async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus({ text: done, tone: 'success' });
    } catch {
      setStatus({ text: text.copyFailed, tone: 'error' });
    }
  };

  return (
    <div className="wallet-pay">
      <a className="button button-primary" href={uri}>
        <i className="fa-solid fa-wallet" aria-hidden="true" /> {text.open}
      </a>
      <button className="button button-secondary" type="button" onClick={() => void copy(uri, text.copied)}>
        <i className="fa-solid fa-link" aria-hidden="true" /> {text.copy}
      </button>
      <small className="field-hint">{text.hint}</small>

      {recipient && transferAmount && (
        <div className="manual-transfer">
          <strong>{text.manualTitle}</strong>
          <span>{text.manualLead}</span>
          <dl>
            <dt>{text.recipient}</dt>
            <dd>
              <code>{recipient}</code>
              <button className="button button-secondary" type="button" onClick={() => void copy(recipient, text.recipientCopied)}>
                <i className="fa-regular fa-copy" aria-hidden="true" /> {text.copyRecipient}
              </button>
            </dd>
            <dt>{text.amount}</dt>
            <dd>
              <code>{transferAmount} USDC</code>
              <button className="button button-secondary" type="button" onClick={() => void copy(transferAmount, text.amountCopied)}>
                <i className="fa-regular fa-copy" aria-hidden="true" /> {text.copyAmount}
              </button>
            </dd>
          </dl>
          <small className="field-hint">{text.manualNote}</small>
        </div>
      )}

      {status && (
        <span className={`wallet-pay-status is-${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'}>
          {status.text}
        </span>
      )}
    </div>
  );
}
