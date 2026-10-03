// Every batch this company emitted: search, ordering, labels to print or download, and live activation counters.
// The codes of a batch are fetched from the server only when it is opened, printed or downloaded.
import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CompanyTextProvider, useCompanyText } from '@/components/company/CompanyText';
import { ConfirmDialog, type Confirmation } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { Pagination, usePagination } from '@/components/ui/Pagination';
import type { Message } from '@/components/ui/StatusMessage';
import { Toast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/client/api';
import { downloadBatchCsv, downloadDataUrl } from '@/lib/client/download';
import {
  fetchPurchase,
  fetchPurchaseDetail,
  forgetPurchase,
  migrateLegacyPurchase,
  PURCHASES_CHANGED_EVENT,
  savedPurchaseIds,
  shipPurchase
} from '@/lib/client/purchases';
import { userSession } from '@/lib/client/session';
import { motionEnabled } from '@/lib/client/theme';
import { errorMessage } from '@/lib/errors';
import type { Locale } from '@/lib/locale';
import type { CompanyBatch } from '@/lib/types';
import { $purchaseIds, $summaries, $summariesReady, isSummary, setSummary, type SummaryEntry } from '@/stores/batches';
import { BatchItem, type BatchAction } from './BatchItem';
import { LabelSheet, type QrKind } from './LabelSheet';
import { PaymentDetail } from './PaymentDetail';

const POLL_MS = 5000;
// Every 12 checks (about a minute) every batch is refreshed, not only the ones waiting for something.
const REFRESH_EVERY_TICKS = 12;

type SortKey = keyof typeof sorters;

type OpenDetail =
  | { purchaseId: string; state: 'payment' | 'loading' }
  | { purchaseId: string; state: 'ready'; batch: CompanyBatch }
  | { purchaseId: string; state: 'error'; message: string };

const createdAt = (summary: SummaryEntry | undefined) => (isSummary(summary) && summary.createdAt ? new Date(summary.createdAt).getTime() : 0);
const quantity = (summary: SummaryEntry | undefined) => (isSummary(summary) ? summary.quantity || 0 : 0);
const claimed = (summary: SummaryEntry | undefined) => (isSummary(summary) ? summary.claimed || 0 : 0);
const claimedRatio = (summary: SummaryEntry | undefined) => (quantity(summary) ? claimed(summary) / quantity(summary) : 0);

const sorters = {
  recent: (first: SummaryEntry | undefined, second: SummaryEntry | undefined) => createdAt(second) - createdAt(first),
  oldest: (first: SummaryEntry | undefined, second: SummaryEntry | undefined) => createdAt(first) - createdAt(second),
  'claimed-desc': (first: SummaryEntry | undefined, second: SummaryEntry | undefined) => claimedRatio(second) - claimedRatio(first) || claimed(second) - claimed(first),
  'claimed-asc': (first: SummaryEntry | undefined, second: SummaryEntry | undefined) => claimedRatio(first) - claimedRatio(second) || claimed(first) - claimed(second),
  'quantity-desc': (first: SummaryEntry | undefined, second: SummaryEntry | undefined) => quantity(second) - quantity(first),
  'quantity-asc': (first: SummaryEntry | undefined, second: SummaryEntry | undefined) => quantity(first) - quantity(second)
};

const SORT_KEYS = Object.keys(sorters) as SortKey[];

// Searches the labels of a batch: what the company knows it by.
const matchesSearch = (summary: SummaryEntry | undefined, query: string) => {
  if (!query) return true;
  if (!isSummary(summary)) return false;
  return [summary.batchId, summary.model, summary.lot, summary.destination]
    .some((label) => Boolean(label) && String(label).toLowerCase().includes(query));
};

// A payment left unpaid for half an hour is checked with the rest, once a minute, instead of every few seconds.
const FRESH_PAYMENT_MS = 30 * 60 * 1000;
const needsPolling = (summary: SummaryEntry | undefined) =>
  isSummary(summary) &&
  (summary.batchId
    ? summary.pendingOnChain > 0
    : !summary.createdAt || Date.now() - new Date(summary.createdAt).getTime() < FRESH_PAYMENT_MS);

interface BatchListProps {
  locale?: Locale | undefined;
  // How many batches each page shows, and whether they stack or sit in a grid (the company panel uses a grid).
  pageSize?: number;
  layout?: 'list' | 'grid';
}

export function BatchList({ locale, pageSize = 10, layout = 'list' }: BatchListProps) {
  return (
    <CompanyTextProvider locale={locale}>
      <Batches pageSize={pageSize} layout={layout} />
    </CompanyTextProvider>
  );
}

function Batches({ pageSize, layout }: { pageSize: number; layout: 'list' | 'grid' }) {
  const t = useCompanyText();
  const purchaseIds = useStore($purchaseIds);
  const summaries = useStore($summaries);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [status, setStatus] = useState<Message | null>(null);
  const [open, setOpen] = useState<OpenDetail | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  // What the panel is asking before doing something that cannot be taken back.
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // purchaseId -> batch with secret codes and QR images, loaded when first needed.
  const fullBatches = useRef(new Map<string, CompanyBatch>());
  // Requests already in flight, so two actions on the same batch share one answer.
  const loadingBatches = useRef(new Map<string, Promise<CompanyBatch>>());
  const openId = useRef('');
  const items = useRef(new Map<string, HTMLElement>());
  const pollTimer = useRef<number | undefined>(undefined);
  const pollTicks = useRef(0);
  // Set when the panel closes: a poll that was mid-request must not schedule the next one.
  const stopped = useRef(false);

  const visibleIds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return purchaseIds
      .filter((purchaseId) => matchesSearch(summaries[purchaseId], normalizedQuery))
      .sort((first, second) => sorters[sort](summaries[first], summaries[second]));
  }, [purchaseIds, summaries, query, sort]);
  const batchPage = usePagination(visibleIds, pageSize);
  const listRef = useRef<HTMLDivElement>(null);
  const { setPage } = batchPage;
  // A new search or order starts from its first page.
  useEffect(() => setPage(1), [query, sort, setPage]);

  const loadFullBatch = (purchaseId: string) => {
    const cached = fullBatches.current.get(purchaseId);
    if (cached) return Promise.resolve(cached);
    // Printing and downloading the same batch at once asked for it twice, and the answer carries every secret code.
    const inFlightRequest = loadingBatches.current.get(purchaseId);
    if (inFlightRequest) return inFlightRequest;
    const request = (async () => {
      const data = await fetchPurchaseDetail(purchaseId);
      if (!data.succeeded || !data.batch) throw new Error(t.batches.notReady);
      fullBatches.current.set(purchaseId, data.batch);
      setSummary(purchaseId, data.purchase);
      return data.batch;
    })().finally(() => loadingBatches.current.delete(purchaseId));
    loadingBatches.current.set(purchaseId, request);
    return request;
  };

  const refreshSummary = async (purchaseId: string) => {
    const previous = $summaries.get()[purchaseId];
    try {
      const { purchase } = await fetchPurchase(purchaseId);
      setSummary(purchaseId, purchase);
    } catch (error) {
      // A network hiccup keeps what was already shown; a purchase the server no longer has is marked.
      if (error instanceof ApiError && error.status === 404) setSummary(purchaseId, { error: t.batches.gone });
      else if (!isSummary(previous)) setSummary(purchaseId, { error: errorMessage(error) });
    }
  };

  // Purchases waiting for their payment or for Solana are checked every POLL_MS; every batch once a minute, so the
  // activation counters follow what customers scan.
  const schedulePolling = () => {
    window.clearTimeout(pollTimer.current);
    if (stopped.current || !$purchaseIds.get().length) return;
    pollTimer.current = window.setTimeout(async () => {
      pollTicks.current += 1;
      const ids = $purchaseIds.get();
      const targets = pollTicks.current % REFRESH_EVERY_TICKS === 0 ? ids : ids.filter((purchaseId) => needsPolling($summaries.get()[purchaseId]));
      await Promise.all(targets.map(refreshSummary));
      schedulePolling();
    }, POLL_MS);
  };

  useEffect(() => {
    if (!userSession.isActive()) {
      $summariesReady.set(true);
      return undefined;
    }
    migrateLegacyPurchase();
    const ids = savedPurchaseIds();
    $purchaseIds.set(ids);
    setLoaded(true);
    void Promise.all(ids.map(refreshSummary)).then(() => {
      $summariesReady.set(true);
      schedulePolling();
    });
    // A purchase created in this page (Generar tokens) joins the list and its polling right away.
    const syncIds = () => {
      const next = savedPurchaseIds();
      const added = next.filter((purchaseId) => !$purchaseIds.get().includes(purchaseId));
      $purchaseIds.set(next);
      if (added.length) void Promise.all(added.map(refreshSummary)).then(schedulePolling);
    };
    window.addEventListener(PURCHASES_CHANGED_EVENT, syncIds);
    return () => {
      stopped.current = true;
      window.clearTimeout(pollTimer.current);
      window.removeEventListener(PURCHASES_CHANGED_EVENT, syncIds);
    };
    // Runs once per page load; polling reads the stores directly.
  }, []);

  // Only one batch is open at a time, so printing prints only its labels.
  const openDetail = async (purchaseId: string) => {
    openId.current = purchaseId;
    const summary = $summaries.get()[purchaseId];
    if (isSummary(summary) && !summary.batchId) {
      setOpen({ purchaseId, state: 'payment' });
      return null;
    }
    const cached = fullBatches.current.get(purchaseId);
    if (cached) {
      setOpen({ purchaseId, state: 'ready', batch: cached });
      return cached;
    }
    setOpen({ purchaseId, state: 'loading' });
    try {
      const batch = await loadFullBatch(purchaseId);
      if (openId.current !== purchaseId) return null;
      setOpen({ purchaseId, state: 'ready', batch });
      return batch;
    } catch (error) {
      if (openId.current === purchaseId) setOpen({ purchaseId, state: 'error', message: errorMessage(error) });
      return null;
    }
  };

  const closeDetail = () => {
    openId.current = '';
    setOpen(null);
  };

  // A purchase paid while its payment QR is open shows its labels instead.
  const openSummary = open ? summaries[open.purchaseId] : undefined;
  useEffect(() => {
    if (open?.state === 'payment' && isSummary(openSummary) && openSummary.batchId) void openDetail(open.purchaseId);
  }, [open, openSummary]);

  const printBatch = async (purchaseId: string) => {
    const batch = await openDetail(purchaseId);
    if (!batch) return;
    // Every label, not only the page on screen, must be in the page before the print dialog takes its snapshot.
    flushSync(() => {
      setPrinting(true);
      setOpen({ purchaseId, state: 'ready', batch });
    });
    try {
      const images = Array.from(items.current.get(purchaseId)?.querySelectorAll<HTMLImageElement>('.label-sheet img') ?? []);
      await Promise.all(images.map((image) => image.decode().catch(() => {})));
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  const runBusy = async (key: string, task: () => Promise<void>) => {
    setBusy((current) => new Set(current).add(key));
    try {
      await task();
    } catch (error) {
      setStatus({ text: errorMessage(error), tone: 'error' });
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleAction = async (purchaseId: string, action: BatchAction) => {
    setStatus(null);
    switch (action) {
      case 'toggle':
        if (openId.current === purchaseId) closeDetail();
        else void openDetail(purchaseId);
        return;
      case 'forget':
        setConfirmation({
          title: t.batches.forgetTitle,
          message: t.batches.forgetMessage,
          confirmLabel: t.batches.forgetConfirmLabel,
          cancelLabel: t.batches.back,
          danger: true,
          onConfirm: () => {
            setConfirmation(null);
            forgetPurchase(purchaseId);
            setSummary(purchaseId, undefined);
            fullBatches.current.delete(purchaseId);
            if (openId.current === purchaseId) closeDetail();
            $purchaseIds.set(savedPurchaseIds());
          }
        });
        return;
      case 'retry':
        setSummary(purchaseId, undefined);
        await refreshSummary(purchaseId);
        schedulePolling();
        return;
      case 'print':
        await runBusy(`${purchaseId}:print`, () => printBatch(purchaseId));
        return;
      case 'csv':
        await runBusy(`${purchaseId}:csv`, async () => downloadBatchCsv(await loadFullBatch(purchaseId)));
        return;
      case 'ship':
        setConfirmation({
          title: t.batches.shipTitle,
          message: t.batches.shipMessage,
          confirmLabel: t.batches.shipConfirmLabel,
          cancelLabel: t.batches.back,
          danger: true,
          onConfirm: () => {
            setConfirmation(null);
            void runBusy(`${purchaseId}:ship`, async () => {
              const { purchase } = await shipPurchase(purchaseId, t.batches.shipFailed);
              setSummary(purchaseId, purchase);
            });
          }
        });
        return;
      case 'lot-qr':
        await runBusy(`${purchaseId}:lot-qr`, async () => {
          const batch = await loadFullBatch(purchaseId);
          await downloadDataUrl(batch.publicQr, t.batches.lotQrFile(batch.batchId));
        });
        return;
    }
  };

  const downloadQr = (purchaseId: string, token: string, kind: QrKind) =>
    runBusy(`${purchaseId}:${token}:${kind}`, async () => {
      const label = (await loadFullBatch(purchaseId)).tokens.find((candidate) => candidate.token === token);
      if (label) await downloadDataUrl(kind === 'secret' ? label.secretQr : label.publicQr, t.batches.qrFile(label.token, kind === 'secret'));
    });

  const detailFor = (purchaseId: string, summary: SummaryEntry | undefined) => {
    if (open?.purchaseId !== purchaseId) return null;
    if (open.state === 'payment' && isSummary(summary)) return <PaymentDetail summary={summary} />;
    if (open.state === 'ready') {
      return (
        <LabelSheet
          batch={open.batch}
          showAll={printing}
          isDownloading={(token, kind) => busy.has(`${purchaseId}:${token}:${kind}`)}
          onDownloadQr={(token, kind) => void downloadQr(purchaseId, token, kind)}
        />
      );
    }
    if (open.state === 'error') return <p className="batch-item-note is-error">{open.message}</p>;
    return <p className="batch-item-note">{t.batches.loadingLabels}</p>;
  };

  const total = purchaseIds.length;

  return (
    <section className="vault" aria-labelledby="batch-list-title">
      <div className="vault-header">
        <h2 id="batch-list-title">{t.batches.title}</h2>
        <span className="vault-count">{total ? t.batches.count(visibleIds.length, total) : ''}</span>
      </div>

      <div className="batch-filters">
        <div className="batch-search">
          <Icon name="fa-solid fa-magnifying-glass" />
          <label className="visually-hidden" htmlFor="batch-search">{t.batches.search}</label>
          <input
            id="batch-search"
            type="search"
            placeholder={t.batches.searchPlaceholder}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <label className="visually-hidden" htmlFor="batch-sort">{t.batches.sort}</label>
        <select id="batch-sort" value={sort} onChange={(event) => setSort(event.currentTarget.value as SortKey)}>
          {SORT_KEYS.map((value) => <option key={value} value={value}>{t.batches.sortOptions[value]}</option>)}
        </select>
      </div>

      <Toast message={status} onClose={() => setStatus(null)} closeLabel={t.notifications.close} />
      <div ref={listRef} className={`batch-list ${layout === 'grid' ? 'is-grid' : ''}`}>
        {batchPage.items.map((purchaseId) => (
          <BatchItem
            key={purchaseId}
            purchaseId={purchaseId}
            summary={summaries[purchaseId]}
            open={open?.purchaseId === purchaseId}
            detail={detailFor(purchaseId, summaries[purchaseId])}
            itemRef={(element) => {
              if (element) items.current.set(purchaseId, element);
              else items.current.delete(purchaseId);
            }}
            isBusy={(action) => busy.has(`${purchaseId}:${action}`)}
            onAction={(action) => void handleAction(purchaseId, action)}
            onPhotoSaved={() => void refreshSummary(purchaseId)}
          />
        ))}
      </div>
      <Pagination page={batchPage.page} pages={batchPage.pages} onPage={(page) => {
          batchPage.setPage(page);
          // The new page starts at the top of the list, not wherever the buttons left the scroll.
          listRef.current?.scrollIntoView({ block: 'start', behavior: motionEnabled() ? 'smooth' : 'auto' });
        }}
        label={t.batches.pages}
        text={t.pagination}
      />
      <ConfirmDialog confirmation={confirmation} onCancel={() => setConfirmation(null)} />
      <div className="vault-empty" hidden={!loaded || visibleIds.length > 0}>
        <p>{total ? t.batches.noMatch : t.batches.empty}</p>
      </div>
    </section>
  );
}
