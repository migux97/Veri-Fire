// The buyer's panel: scan the secret QR inside a product, activate its warranty, list the warranties already owned and
// pass them on to a new owner through a transfer link, or accept one.
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { ConfirmDialog, type Confirmation } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import type { Message, MessageTone } from '@/components/ui/StatusMessage';
import { Toast } from '@/components/ui/Toast';
import { useNow } from '@/components/ui/useNow';
import { activateWarranty, previewClaim } from '@/lib/client/activation';
import { setShowcase } from '@/lib/client/showcase';
import { ApiError, getJson } from '@/lib/client/api';
import {
  captureClaimLink, takePendingClaim, takePendingTransfer
} from '@/lib/client/qr';
import { parseScannedQr, type ScannedClaim } from '@/lib/qr-codes';
import { userSession } from '@/lib/client/session';
import {
  acceptTransfer, cancelTransfer, offerTransfer, readTransferLink, savedTransferLink, type IncomingTransfer
} from '@/lib/client/transfer';
import { resolveWalletAddress } from '@/lib/client/wallet';
import { errorMessage } from '@/lib/errors';
import { formatCountdown } from '@/lib/format';
import type { ClaimPreview, TransferredWarranty, Warranty, WarrantiesResponse } from '@/lib/types';
import { QrScanPanel } from './QrScanPanel';
import { ShowcaseConsent } from './ShowcaseConsent';
import { WarrantyVault, type ShowcaseControls, type TransferControls } from './WarrantyVault';
import { fillIn, getConsumerMessages, type ConsumerLocale } from '@/i18n/consumer';

// While a transfer link is open, the list is checked this often, so the owner sees when someone accepts it.
const TRANSFER_POLL_MS = 8000;

interface WarrantyDashboardProps {
  locale?: ConsumerLocale;
}

export function WarrantyDashboard({ locale = 'es' }: WarrantyDashboardProps) {
  const labels = getConsumerMessages(locale);
  const { claim: claimCopy, incoming: incomingCopy, card } = labels;
  const [message, setMessage] = useState<Message | null>(null);
  const [scannedClaim, setScannedClaim] = useState<ScannedClaim | null>(null);
  const [claiming, setClaiming] = useState(false);
  // What the scanned product looks like and whether the buyer agreed to show it on the home page (never by default).
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showcaseChoice, setShowcaseChoice] = useState(false);
  const [showcaseBusy, setShowcaseBusy] = useState<string | null>(null);
  const [warranties, setWarranties] = useState<Warranty[] | null>(null);
  const [transferred, setTransferred] = useState<TransferredWarranty[]>([]);
  const [vaultStatus, setVaultStatus] = useState<string | null>(claimCopy.loading);
  const [incoming, setIncoming] = useState<{ secret: string; transfer: IncomingTransfer } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [transferLinks, setTransferLinks] = useState<Record<string, string>>({});
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [transferStatuses, setTransferStatuses] = useState<Record<string, Message>>({});
  // What the panel is asking before doing something that cannot be taken back.
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const now = useNow(incoming !== null);
  const incomingExpired = incoming !== null && new Date(incoming.transfer.expiresAt).getTime() <= now;
  const walletAddress = useRef('');
  // Answers of loads started before the last change to the list are stale: a slow poll must not undo what an action
  // (a link just opened, a warranty just activated) already wrote on screen.
  const loadRequest = useRef(0);
  const claimButtonRef = useRef<HTMLButtonElement>(null);

  const showMessage = (text: string, tone: MessageTone) => setMessage({ text, tone });

  useEffect(() => {
    if (scannedClaim) claimButtonRef.current?.focus();
  }, [scannedClaim]);

  // A new QR asks again: the choice belongs to one product and starts unticked.
  useEffect(() => {
    setShowcaseChoice(false);
    setPreview(null);
    if (!scannedClaim) return undefined;
    let current = true;
    setPreviewing(true);
    void previewClaim(scannedClaim).then((next) => {
      if (!current) return;
      setPreview(next);
      setPreviewing(false);
    });
    return () => {
      current = false;
    };
  }, [scannedClaim]);

  // quiet: a background check, which neither shows "Cargando" nor replaces the list with an error.
  const loadWarranties = async ({ quiet = false } = {}) => {
    if (!quiet) setVaultStatus(claimCopy.loading);
    const request = ++loadRequest.current;
    try {
      walletAddress.current ||= await resolveWalletAddress();
      const data = await getJson<WarrantiesResponse>(`/api/warranties?owner=${encodeURIComponent(walletAddress.current)}`, claimCopy.loadError);
      if (request !== loadRequest.current) return data;
      setWarranties(data.warranties);
      setTransferred(data.transferred);
      // Links this browser opened can be shared again; the secret of a link lives only here.
      setTransferLinks(Object.fromEntries(data.warranties.flatMap((warranty) => {
        const link = warranty.transferOfferedAt ? savedTransferLink(warranty.token) : null;
        return link ? [[warranty.token, link]] : [];
      })));
      setVaultStatus(null);
      return data;
    } catch (error) {
      if (!quiet && request === loadRequest.current) setVaultStatus(errorMessage(error));
      return null;
    }
  };

  // What is on screen is newer than any load in flight.
  const listChanged = () => { loadRequest.current += 1; };

  // An open link is accepted in someone else's browser: check until it happens and tell the owner right away.
  // With the offer date: a product that once left this account and came back already has an older transfer listed.
  const openOffers = warranties?.filter((warranty) => warranty.transferExpiresAt).map((warranty) => `${warranty.token}@${warranty.transferOfferedAt ?? ''}`).join(',') ?? '';
  useEffect(() => {
    if (!openOffers) return undefined;
    const offers = openOffers.split(',').map((offer) => {
      const [token = '', offeredAt = ''] = offer.split('@');
      return { token, offeredAt: new Date(offeredAt).getTime() || 0 };
    });
    const timer = window.setInterval(async () => {
      const data = await loadWarranties({ quiet: true });
      const given = data?.transferred.find((product) =>
        offers.some((offer) => offer.token === product.token && new Date(product.at).getTime() >= offer.offeredAt));
      if (given) showMessage(fillIn(incomingCopy.given, { model: given.model, to: given.to }), 'success');
    }, TRANSFER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [openOffers]);

  const ownerAddress = async () => (walletAddress.current ||= await resolveWalletAddress());

  // A transfer link opened or scanned: show what it offers before accepting.
  const openTransferLink = async (secret: string) => {
    setIncoming(null);
    showMessage(incomingCopy.reading, 'info');
    try {
      setIncoming({ secret, transfer: await readTransferLink(secret, await ownerAddress()) });
      setMessage(null);
    } catch (error) {
      showMessage(errorMessage(error), 'error');
    }
  };

  const handleAcceptTransfer = async () => {
    if (!incoming) return;
    setAccepting(true);
    try {
      const warranty = await acceptTransfer(incoming.transfer, await ownerAddress(), (progress) => showMessage(progress, 'info'));
      setIncoming(null);
      showMessage(fillIn(incomingCopy.accepted, { model: warranty.model }), 'success');
      await loadWarranties();
    } catch (error) {
      showMessage(errorMessage(error), 'error');
    } finally {
      setAccepting(false);
    }
  };

  // Opening and cancelling a link: the owner's wallet signs, and the card shows how it went.
  const runTransfer = async (token: string, task: (owner: string, onProgress: (text: string) => void) => Promise<Warranty>, done: string) => {
    const setStatus = (text: string, tone: MessageTone) => setTransferStatuses((current) => ({ ...current, [token]: { text, tone } }));
    setBusyToken(token);
    try {
      const warranty = await task(await ownerAddress(), (progress) => setStatus(progress, 'info'));
      listChanged();
      setWarranties((current) => current?.map((candidate) => (candidate.token === token ? warranty : candidate)) ?? current);
      setStatus(done, 'success');
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    } finally {
      setBusyToken(null);
    }
  };

  const transfers: TransferControls = {
    links: transferLinks,
    busyToken,
    statuses: transferStatuses,
    onOffer: (token) => void runTransfer(token, async (owner, onProgress) => {
      const { warranty, link } = await offerTransfer(token, owner, onProgress);
      setTransferLinks((current) => ({ ...current, [token]: link }));
      return warranty;
    }, card.linkReady),
    onCancel: (token) => setConfirmation({
      title: card.confirmCancelTitle,
      message: card.confirmCancel,
      confirmLabel: card.confirmCancelYes,
      cancelLabel: card.keep,
      danger: true,
      onConfirm: () => {
        setConfirmation(null);
        void runTransfer(token, async (owner, onProgress) => {
          const warranty = await cancelTransfer(token, owner, onProgress);
          setTransferLinks(({ [token]: _closed, ...rest }) => rest);
          return warranty;
        }, card.linkCancelled);
      }
    })
  };

  // Showing a product on the home page needs the warning first; hiding it does not. The wallet signs either.
  const showcase: ShowcaseControls = {
    busyToken: showcaseBusy,
    onToggle: (token, visible) => {
      const run = async () => {
            setShowcaseBusy(token);
        try {
          const warranty = await setShowcase(await ownerAddress(), token, visible);
          listChanged();
          setWarranties((current) => current?.map((candidate) => (candidate.token === token ? warranty : candidate)) ?? current);
          showMessage(visible ? card.showcase.shown : card.showcase.hidden, 'success');
        } catch (error) {
          showMessage(errorMessage(error), 'error');
        } finally {
          setShowcaseBusy(null);
        }
      };
      if (!visible) {
        void run();
        return;
      }
      setConfirmation({
        title: card.showcase.confirmTitle,
        message: card.showcase.confirmMessage,
        confirmLabel: card.showcase.confirmYes,
        cancelLabel: card.keep,
        onConfirm: () => {
          setConfirmation(null);
          void run();
        }
      });
    }
  };

  const applyScannedText = (text: string) => {
    const { claim, publicToken, transfer } = parseScannedQr(text);
    if (transfer) {
      setScannedClaim(null);
      void openTransferLink(transfer);
      return;
    }
    setScannedClaim(claim);
    if (claim) {
      showMessage(claimCopy.detected, 'success');
      return;
    }
    showMessage(publicToken ? claimCopy.publicQr : claimCopy.unknownQr, 'error');
  };

  const handleClaim = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scannedClaim) {
      showMessage(claimCopy.scanFirst, 'error');
      return;
    }
    void claim(scannedClaim);
  };

  const claim = async (scannedClaim: ScannedClaim) => {
    setClaiming(true);
    showMessage(claimCopy.working, 'info');
    try {
      const owner = walletAddress.current || await resolveWalletAddress();
      const product = await activateWarranty(scannedClaim, owner, showcaseChoice && preview?.canShowcase === true, (progress) => showMessage(progress, 'info'));
      setScannedClaim(null);
      showMessage(fillIn(product.certificateUrl ? claimCopy.doneOnChain : claimCopy.done, { model: product.model }), 'success');
      await loadWarranties();
    } catch (error) {
      // A QR that does not exist or was already used will not work on a retry.
      if (error instanceof ApiError && error.status < 500 && !error.retryable) setScannedClaim(null);
      showMessage(errorMessage(error), 'error');
    } finally {
      setClaiming(false);
    }
  };

  useEffect(() => {
    // Without a session the page's guard is already sending the user to the login page.
    if (!userSession.isActive()) return;

    captureClaimLink();
    const pendingTransfer = takePendingTransfer();
    const pendingClaim = takePendingClaim();
    if (pendingClaim === 'invalid') {
      showMessage(claimCopy.unreadableQr, 'error');
    } else if (pendingClaim) {
      setScannedClaim(pendingClaim);
      showMessage(claimCopy.detected, 'success');
    }

    void loadWarranties()
      .then(() => (pendingTransfer ? openTransferLink(pendingTransfer) : undefined));
    // Runs once per page load.
  }, []);

  return (
    <>
      {incoming && (
        <section className="claim-card transfer-card" aria-labelledby="transfer-title">
          <div>
            <span className="eyebrow">{incomingCopy.eyebrow}</span>
            <h2 id="transfer-title">{incomingCopy.title}</h2>
          </div>
          <dl className="transfer-summary">
            <div><dt>{incomingCopy.product}</dt><dd>{incoming.transfer.model}</dd></div>
            <div><dt>{incomingCopy.code}</dt><dd>{incoming.transfer.token}</dd></div>
            <div><dt>{incomingCopy.owner}</dt><dd>{incoming.transfer.from}</dd></div>
          </dl>
          <p className="claim-hint">{incomingCopy.note}</p>
          <p className="transfer-countdown" role="timer">
            <Icon name="fa-regular fa-clock" />
            {incomingExpired
              ? ` ${incomingCopy.expired}`
              : <> {incomingCopy.expiresIn} <strong>{formatCountdown(incoming.transfer.expiresAt, now)}</strong></>}
          </p>
          <div className="scan-actions">
            <button className="button button-primary" type="button" disabled={accepting || incomingExpired} onClick={() => void handleAcceptTransfer()}>
              {incomingCopy.accept}
            </button>
            <button className="button button-secondary" type="button" disabled={accepting} onClick={() => setIncoming(null)}>{incomingCopy.discard}</button>
          </div>
        </section>
      )}

      <section className="claim-card" aria-labelledby="claim-title">
        <div>
          <span className="eyebrow">{claimCopy.eyebrow}</span>
          <h1 id="claim-title">{claimCopy.title}</h1>
        </div>
        <p className="claim-hint">
          {claimCopy.hint} <kbd>Ctrl</kbd> + <kbd>V</kbd>. {claimCopy.onceHint}
        </p>
        <QrScanPanel
          locale={locale}
          disabled={claiming}
          onDetected={applyScannedText}
          onMessage={setMessage}
          onScanStart={() => setScannedClaim(null)}
        />
        <Toast message={message} onClose={() => setMessage(null)} closeLabel={labels.vault.closeNotice} />
        <form id="claim-form" noValidate hidden={!scannedClaim} onSubmit={handleClaim}>
          <ShowcaseConsent preview={preview} checking={previewing} checked={showcaseChoice} onChange={setShowcaseChoice} disabled={claiming} locale={locale} />
          <button ref={claimButtonRef} className="button button-primary" type="submit" disabled={claiming}>{claimCopy.activate}</button>
        </form>
      </section>

      <WarrantyVault warranties={warranties} status={vaultStatus} transfers={transfers} showcase={showcase} transferred={transferred} locale={locale} />
      <ConfirmDialog confirmation={confirmation} onCancel={() => setConfirmation(null)} />
    </>
  );
}
