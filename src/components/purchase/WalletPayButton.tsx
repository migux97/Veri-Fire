// Pays a batch from the company's Privy wallet: the server builds the USDC transfer with the purchase's Solana Pay
// reference, the wallet signs it, and the server pays the network fee and sends it. The same payment can be made from
// any Solana Pay wallet by scanning the QR next to this button.
import { useState } from 'react';
import { useCompanyText } from '@/components/company/CompanyText';
import { postJson } from '@/lib/client/api';
import { connectSigner } from '@/lib/client/signer';
import { resolveWalletAddress } from '@/lib/client/wallet';
import { errorMessage } from '@/lib/errors';
import type { PurchaseStatus, UnsignedTransaction } from '@/lib/types';

interface WalletPayButtonProps {
  purchaseId: string;
  onPaid?: (status: PurchaseStatus) => void;
}

export function WalletPayButton({ purchaseId, onPaid }: WalletPayButtonProps) {
  const t = useCompanyText();
  const text = t.purchase.wallet;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(null);

  const pay = async () => {
    setBusy(true);
    setStatus({ text: text.opening, tone: 'info' });
    const url = `/api/purchases/${encodeURIComponent(purchaseId)}/paid`;
    try {
      const payer = await resolveWalletAddress();
      const wallet = await connectSigner(payer);
      const answer = await postJson<UnsignedTransaction | PurchaseStatus>(url, { payer }, text.failed);
      // Paid meanwhile from the QR: nothing to sign.
      if (!('tx' in answer)) {
        onPaid?.(answer);
        setStatus({ text: text.paid, tone: 'success' });
        return;
      }
      const signedTx = await wallet.signTransaction(answer.tx);
      setStatus({ text: text.confirming, tone: 'info' });
      const paid = await postJson<PurchaseStatus>(url, { payer, signedTx }, text.failed);
      setStatus({ text: paid.succeeded ? text.paid : text.sent, tone: 'success' });
      onPaid?.(paid);
    } catch (error) {
      setStatus({ text: errorMessage(error) || text.failed, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wallet-pay">
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void pay()}>
        <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-wallet'}`} aria-hidden="true" /> {busy ? text.busy : text.action}
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
