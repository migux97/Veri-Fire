import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { relativeTime } from '@/i18n/company';
import { storedUser } from '@/lib/client/account';
import { readSchedules, SCHEDULES_CHANGED_EVENT, type ScheduleItem } from '@/lib/client/schedules';
import { motionEnabled } from '@/lib/client/theme';
import { formatNumber } from '@/lib/format';
import type { PurchaseSummary } from '@/lib/types';
import { useCompanyText } from './CompanyText';

const percentage = (value: number, total: number) => (total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0);

const reducedMotion = () => !motionEnabled() || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A figure that counts up from zero when it first appears, and glides to its new value when it changes.
function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion()) {
      from.current = value;
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    const origin = from.current;
    const duration = 900;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // easeOutCubic: fast at first, settling gently.
      const eased = 1 - (1 - progress) ** 3;
      const current = origin + (value - origin) * eased;
      from.current = current;
      setShown(current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(shown)}</>;
}

// Charts grow from nothing once they are on screen, so the panel does not start already drawn.
function useReveal() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return shown;
}

function useUpcoming() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  useEffect(() => {
    const load = () =>
      setItems(
        readSchedules()
          .filter((item) => Date.parse(item.date) > Date.now() - 24 * 60 * 60 * 1000)
          .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
          .slice(0, 4)
      );
    load();
    window.addEventListener(SCHEDULES_CHANGED_EVENT, load);
    const timer = window.setInterval(load, 60_000);
    return () => {
      window.removeEventListener(SCHEDULES_CHANGED_EVENT, load);
      window.clearInterval(timer);
    };
  }, []);
  return items;
}

export function CompanyOverview({ records, loading }: { records: PurchaseSummary[]; loading: boolean }) {
  const t = useCompanyText();
  const text = t.overview;
  const number = (value: number, digits = 1) => formatNumber(value, digits, t.intl);
  const [name, setName] = useState('');
  const revealed = useReveal();
  const upcoming = useUpcoming();

  useEffect(() => {
    setName((storedUser()?.name ?? '').split(/\s+/)[0] ?? '');
  }, []);

  if (loading)
    return (
      <div className="company-overview" role="status" aria-label={text.loading}>
        <div className="company-skeleton company-skeleton-hero" />
        <div className="company-metrics">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="company-skeleton company-skeleton-metric" key={index} />
          ))}
        </div>
        <div className="company-skeleton company-skeleton-chart" />
      </div>
    );

  const issued = records.filter((record) => record.batchId);
  const units = issued.reduce((sum, record) => sum + record.quantity, 0);
  const claimed = issued.reduce((sum, record) => sum + record.claimed, 0);
  const pending = records.length - issued.length;
  const activation = percentage(claimed, units);
  const investment = issued.reduce((sum, record) => sum + Number(record.amount), 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? text.greeting.morning : hour < 20 ? text.greeting.afternoon : text.greeting.evening;

  const hero = (
    <section className="company-hero">
      <div className="company-hero-text">
        <span className="company-eyebrow">{new Intl.DateTimeFormat(t.intl, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span>
        <h2>{name ? text.hello(greeting, name) : greeting}</h2>
        <p>{text.heroText(issued.length, number(activation))}</p>
      </div>
      <div className="company-hero-actions">
        <a className="company-button is-primary" href="#generate" data-issuance-mode="now">
          <i className="fa-solid fa-bolt" aria-hidden="true" /> {text.quick.generate}
        </a>
        <a className="company-button" href="#generate" data-issuance-mode="payment">
          <i className="fa-solid fa-calendar-plus" aria-hidden="true" /> {text.quick.payment}
        </a>
        <a className="company-button is-ghost" href="#batches">
          <i className="fa-solid fa-boxes-stacked" aria-hidden="true" /> {text.quick.batches}
        </a>
      </div>
    </section>
  );

  const agenda = (
    <section className="company-card company-agenda">
      <div className="company-card-heading">
        <div>
          <span className="company-eyebrow">{text.agenda.eyebrow}</span>
          <h2>{text.agenda.title}</h2>
        </div>
        <a className="company-link" href="#generate" data-issuance-mode="payment">
          {text.agenda.open} <i className="fa-solid fa-arrow-right" aria-hidden="true" />
        </a>
      </div>
      {upcoming.length ? (
        <ul className="company-agenda-list">
          {upcoming.map((item) => {
            const overdue = Date.parse(item.date) <= Date.now();
            return (
              <li key={item.id} className={overdue ? 'is-overdue' : ''}>
                <span className={`company-agenda-icon is-${item.type}`} aria-hidden="true">
                  <i className={`fa-solid ${item.type === 'payment' ? 'fa-coins' : 'fa-layer-group'}`} />
                </span>
                <span className="company-agenda-text">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <time dateTime={item.date} className="company-agenda-when">
                  {overdue ? t.operations.overdue : relativeTime(new Date(Date.parse(item.date)).toISOString(), t.intl)}
                </time>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="company-data-empty">{text.agenda.empty}</p>
      )}
    </section>
  );

  if (!records.length)
    return (
      <div className="company-overview">
        {hero}
        <section className="company-card company-empty is-large">
          <span className="company-empty-icon" aria-hidden="true">
            <i className="fa-solid fa-seedling" />
          </span>
          <h2>{text.emptyTitle}</h2>
          <p>{text.empty}</p>
        </section>
        {agenda}
      </div>
    );

  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const count = issued
      .filter((purchase) => {
        if (!purchase.createdAt) return false;
        const created = new Date(purchase.createdAt);
        return created.getFullYear() === date.getFullYear() && created.getMonth() === date.getMonth();
      })
      .reduce((sum, purchase) => sum + purchase.quantity, 0);
    return { label: date.toLocaleDateString(t.intl, { month: 'short' }), count };
  });
  const max = Math.max(1, ...months.map((month) => month.count));
  const metrics = [
    { label: text.metrics.units, value: units, format: (value: number) => number(value, 0), detail: text.metrics.unitsDetail(issued.length), icon: 'cubes-stacked', color: 'blue' },
    { label: text.metrics.claimed, value: claimed, format: (value: number) => number(value, 0), detail: text.metrics.claimedDetail(number(activation)), icon: 'circle-check', color: 'green' },
    {
      label: text.metrics.pending,
      value: pending,
      format: (value: number) => number(value, 0),
      detail: text.metrics.pendingDetail(number(percentage(pending, records.length))),
      icon: 'clock',
      color: 'amber'
    },
    { label: text.metrics.investment, value: investment, format: (value: number) => `${number(value, 0)} USDC`, detail: text.metrics.investmentDetail, icon: 'wallet', color: 'red' }
  ];

  return (
    <div className="company-overview">
      {hero}
      <section className="company-metrics" aria-label={text.metricsLabel}>
        {metrics.map((metric) => (
          <article className="company-metric" key={metric.label}>
            <span className={`metric-icon metric-${metric.color}`}>
              <i className={`fa-solid fa-${metric.icon}`} aria-hidden="true" />
            </span>
            <div>
              <small>{metric.label}</small>
              <strong>
                <AnimatedNumber value={metric.value} format={metric.format} />
              </strong>
              <em>{metric.detail}</em>
            </div>
          </article>
        ))}
      </section>
      <div className="company-overview-grid">
        <section className="company-card company-chart-card">
          <span className="company-eyebrow">{text.chart.eyebrow}</span>
          <h2>{text.chart.title}</h2>
          <p className="company-chart-caption">{text.chart.caption}</p>
          <div className="company-bars" role="img" aria-label={months.map((month) => text.chart.label(month.label, number(month.count, 0))).join('; ')}>
            {months.map((month, index) => (
              <div className="company-bar-column" key={month.label} style={{ '--bar-index': index } as CSSProperties}>
                <strong>{number(month.count, 0)}</strong>
                <div className="company-bar-track">
                  <div className="company-bar" style={{ height: revealed ? `${(month.count / max) * 100}%` : '0%' }} />
                </div>
                <span>{month.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="company-card company-donut-card">
          <span className="company-eyebrow">{text.donut.eyebrow}</span>
          <h2>{text.donut.title}</h2>
          <div
            className="company-donut"
            style={{ '--activation': `${revealed ? activation : 0}%` } as CSSProperties}
            role="img"
            aria-label={text.donut.label(number(activation))}
          >
            <div>
              <strong>
                <AnimatedNumber value={activation} format={(value) => `${number(value)}%`} />
              </strong>
              <span>{text.donut.activated}</span>
            </div>
          </div>
          <dl className="company-chart-legend">
            <div>
              <dt>
                <i className="legend-dot is-claimed" aria-hidden="true" /> {text.donut.claimed}
              </dt>
              <dd>{number(claimed, 0)}</dd>
            </div>
            <div>
              <dt>
                <i className="legend-dot" aria-hidden="true" /> {text.donut.unclaimed}
              </dt>
              <dd>{number(Math.max(0, units - claimed), 0)}</dd>
            </div>
          </dl>
        </section>
        {agenda}
        <section className="company-card company-overview-status">
          <span className="company-eyebrow">{text.status.eyebrow}</span>
          <h2>{text.status.title}</h2>
          {[
            { label: text.status.issued, count: issued.length, tone: 'is-ok' },
            { label: text.status.pending, count: pending, tone: 'is-pending' }
          ].map((item) => (
            <div className="company-progress-row" key={item.label}>
              <div>
                <span>{item.label}</span>
                <strong>
                  {item.count} · {number(percentage(item.count, records.length))}%
                </strong>
              </div>
              <div className="company-progress" role="img" aria-label={`${item.label}: ${item.count}`}>
                <span className={item.tone} style={{ width: revealed ? `${percentage(item.count, records.length)}%` : '0%' }} />
              </div>
            </div>
          ))}
        </section>
      </div>
      <section className="company-card">
        <span className="company-eyebrow">{text.table.eyebrow}</span>
        <h2>{text.table.title}</h2>
        <div className="company-table-wrap">
          <table className="company-table">
            <caption className="company-chart-caption">{text.table.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{text.table.lot}</th>
                <th scope="col">{text.table.status}</th>
                <th scope="col">{text.table.units}</th>
                <th scope="col">{text.table.claimed}</th>
                <th scope="col">{text.table.activation}</th>
                <th scope="col">{text.table.amount}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((purchase) => (
                <tr key={purchase.purchaseId}>
                  <td>
                    <strong>{purchase.lot}</strong>
                    <small>{purchase.model}</small>
                  </td>
                  <td>
                    <span className={`status-pill ${purchase.batchId ? 'is-claimed' : 'is-pending'}`}>
                      {purchase.batchId ? text.table.generated : t.common.pending}
                    </span>
                  </td>
                  <td>{number(purchase.quantity, 0)}</td>
                  <td>{number(purchase.claimed, 0)}</td>
                  <td>
                    {purchase.batchId ? (
                      <span className="table-meter">
                        <span className="table-meter-track">
                          <span style={{ width: `${percentage(purchase.claimed, purchase.quantity)}%` }} />
                        </span>
                        {number(percentage(purchase.claimed, purchase.quantity), 0)}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{number(Number(purchase.amount))} USDC</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
