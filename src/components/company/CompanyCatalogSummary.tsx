import { useStore } from '@nanostores/react';
import { formatNumber } from '@/lib/format';
import type { Locale } from '@/lib/locale';
import type { PurchaseSummary } from '@/lib/types';
import { $purchaseIds, $summaries, $summariesReady, isSummary } from '@/stores/batches';
import { CompanyTextProvider, useCompanyText, useHydrated } from './CompanyText';

export function CompanyCatalogSummary({ locale }: { locale?: Locale | undefined }) {
  return (
    <CompanyTextProvider locale={locale}>
      <Summary />
    </CompanyTextProvider>
  );
}

function Summary() {
  const t = useCompanyText();
  const text = t.catalog;
  const number = (value: number) => formatNumber(value, 2, t.intl);
  // The stores may already hold the batches when this island hydrates; the first render must match the server's.
  const hydrated = useHydrated();
  const storedIds = useStore($purchaseIds);
  const summaries = useStore($summaries);
  const ids = hydrated ? storedIds : [];
  const records = ids.map((id) => summaries[id]).filter((entry): entry is PurchaseSummary => isSummary(entry));
  const ready = useStore($summariesReady);
  // While the summaries arrive one by one every list is "incomplete": it only means something once they all answered.
  const incomplete = ready && records.length !== ids.length;
  const issued = records.filter((record) => record.batchId);
  const units = issued.reduce((sum, record) => sum + record.quantity, 0);
  const claimed = issued.reduce((sum, record) => sum + record.claimed, 0);
  const pending = records.filter((record) => !record.batchId);
  const recent = [...issued].sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0)).slice(0, 5);
  const metrics: [string, string, string][] = [
    [text.metrics.batches, number(issued.length), 'layer-group'],
    [text.metrics.tokens, number(units), 'cubes-stacked'],
    [text.metrics.claimed, number(claimed), 'circle-check'],
    [text.metrics.percent, units ? `${number((claimed / units) * 100)}%` : '—', 'chart-pie']
  ];
  return (
    <>
      {incomplete && (
        <p className="company-data-empty" role="status">
          {text.incomplete}
        </p>
      )}
      <section className="company-metrics" aria-label={text.metricsLabel}>
        {metrics.map(([label, value, icon]) => (
          <article className="company-metric" key={label}>
            <span className="metric-icon metric-red">
              <i className={`fa-solid fa-${icon}`} aria-hidden="true" />
            </span>
            <div>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          </article>
        ))}
      </section>
      <div className="company-emission-summary">
        <section className="company-card">
          <h2>{text.emission.title}</h2>
          <dl className="company-emission-values">
            <div>
              <dt>{text.emission.pendingPurchases}</dt>
              <dd>{number(pending.length)}</dd>
            </div>
            <div>
              <dt>{text.emission.pendingTokens}</dt>
              <dd>{number(pending.reduce((sum, record) => sum + record.quantity, 0))}</dd>
            </div>
            <div>
              <dt>{text.emission.pendingAmount}</dt>
              <dd>{number(pending.reduce((sum, record) => sum + Number(record.amount), 0))} USDC</dd>
            </div>
            <div>
              <dt>{text.emission.investment}</dt>
              <dd>{number(issued.reduce((sum, record) => sum + Number(record.amount), 0))} USDC</dd>
            </div>
            <div>
              <dt>{text.emission.onChain}</dt>
              <dd>{number(records.reduce((sum, record) => sum + record.registeredOnChain, 0))}</dd>
            </div>
            <div>
              <dt>{text.emission.pendingOnChain}</dt>
              <dd>{number(records.reduce((sum, record) => sum + record.pendingOnChain, 0))}</dd>
            </div>
          </dl>
        </section>
        <section className="company-card">
          <h2>{text.recent.title}</h2>
          {!recent.length ? (
            <p className="company-data-empty">{text.recent.empty}</p>
          ) : (
            <div className="company-table-wrap">
              <table className="company-table">
                <thead>
                  <tr>
                    <th scope="col">{text.recent.lot}</th>
                    <th scope="col">{text.recent.destination}</th>
                    <th scope="col">{text.recent.tokens}</th>
                    <th scope="col">{text.recent.claimed}</th>
                    <th scope="col">{text.recent.date}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((record) => (
                    <tr key={record.purchaseId}>
                      <td>
                        <strong>{record.lot}</strong>
                        <small>{record.model}</small>
                      </td>
                      <td>{record.destination}</td>
                      <td>{number(record.quantity)}</td>
                      <td>{number(record.claimed)}</td>
                      <td className="table-date">{record.createdAt ? new Date(record.createdAt).toLocaleDateString(t.intl) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
