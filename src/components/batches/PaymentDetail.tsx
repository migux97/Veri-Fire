import { useCompanyText } from '@/components/company/CompanyText';
import { PaymentWarning } from '@/components/ui/PaymentWarning';
import { WalletPayButton } from '@/components/purchase/WalletPayButton';
import { setSummary } from '@/stores/batches';
import type { PurchaseSummary } from '@/lib/types';

interface PaymentDetailProps {
  summary: PurchaseSummary;
}

// A purchase still waiting for its payment: the Solana Pay QR, kept so it can be paid from the list.
export function PaymentDetail({ summary }: PaymentDetailProps) {
  const t = useCompanyText();
  const text = t.batches.payment;
  return (
    <>
      <p>
        <strong>{text.pay(summary.amount, summary.asset)}</strong>
        {text.toIssue(summary.quantity, summary.model)}
      </p>
      <p className="batch-item-note">{text.note}</p>
      <PaymentWarning text={t.purchase.warning} />
      {summary.payment?.qr
        ? <img className="payment-qr" src={summary.payment.qr} alt={text.alt} width={240} height={240} />
        : <p className="batch-item-note is-error">{text.missing}</p>}
      {summary.payment?.uri && (
        <WalletPayButton
          purchaseId={summary.purchaseId}
          // The list reads the purchase again, so the batch shows up without waiting for the next check.
          onPaid={(status) => setSummary(summary.purchaseId, status.purchase)}
        />
      )}
    </>
  );
}
