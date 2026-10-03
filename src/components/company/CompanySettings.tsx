// Configuración of the company panel: company profile, brand, warranties, animations, notifications and role permissions.
// The language and the light/dark theme are chosen in the header.
// Every choice is kept in this browser.
import { useEffect, useState, type ReactNode } from 'react';
import { defaultPrefs, notify, readPrefs, savePrefs, type LeadHours, type NotificationPrefs } from '@/lib/client/notifications';
import { motionEnabled, setMotionEnabled } from '@/lib/client/theme';
import type { Locale } from '@/lib/locale';
import { CompanyBrandSettings } from './CompanyBrandSettings';
import { CompanyVerification } from './CompanyVerification';
import { CompanyProfileSettings } from './CompanyProfileSettings';
import { CompanyRoleSettings } from './CompanyRoleSettings';
import { CompanyWarrantySettings } from './CompanyWarrantySettings';
import { CompanyTextProvider, useCompanyText } from './CompanyText';

export function CompanySettings({ locale = 'es' }: { locale?: Locale | undefined }) {
  return (
    <CompanyTextProvider locale={locale}>
      <Settings />
    </CompanyTextProvider>
  );
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="settings-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Row({ title, help, children }: { title: string; help?: string | undefined; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        {help && <small>{help}</small>}
      </div>
      {children}
    </div>
  );
}

function Card({ icon, title, lead, badge, children }: { icon: string; title: string; lead: string; badge?: string; children: ReactNode }) {
  return (
    <section className="company-card settings-card">
      <div className="settings-card-heading">
        <span className="settings-icon" aria-hidden="true">
          <i className={`fa-solid ${icon}`} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{lead}</p>
        </div>
        {badge && <span className="company-badge is-warning">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function Settings() {
  const t = useCompanyText();
  const text = t.settings;
  const [motion, setMotion] = useState(true);
  const [systemReduced, setSystemReduced] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setMotion(motionEnabled());
    setSystemReduced(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    setPrefs(readPrefs());
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  const chooseMotion = (value: boolean) => {
    setMotionEnabled(value);
    setMotion(value);
  };

  const updatePrefs = (next: Partial<NotificationPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    savePrefs(merged);
  };

  const chooseBrowser = async (value: boolean) => {
    if (!value || permission === 'unsupported') return updatePrefs({ browser: false });
    const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setPermission(result);
    updatePrefs({ browser: result === 'granted' });
  };

  return (
    <div className="settings-grid">
      <CompanyProfileSettings />
      <CompanyBrandSettings />
      <CompanyVerification />

      <CompanyWarrantySettings />

      <Card icon="fa-palette" title={text.appearance.title} lead={text.appearance.lead}>
        <Row title={text.appearance.motion} help={systemReduced && motion ? text.appearance.motionSystem : text.appearance.motionHelp}>
          <Switch checked={motion} onChange={chooseMotion} label={text.appearance.motion} />
        </Row>
      </Card>

      <Card icon="fa-bell" title={text.notifications.title} lead={text.notifications.lead}>
        <Row title={text.notifications.payments} help={text.notifications.paymentsHelp}>
          <Switch checked={prefs.payments} onChange={(value) => updatePrefs({ payments: value })} label={text.notifications.payments} />
        </Row>
        <Row title={text.notifications.batches} help={text.notifications.batchesHelp}>
          <Switch checked={prefs.batches} onChange={(value) => updatePrefs({ batches: value })} label={text.notifications.batches} />
        </Row>
        <Row title={text.notifications.reminders} help={text.notifications.remindersHelp}>
          <Switch checked={prefs.reminders} onChange={(value) => updatePrefs({ reminders: value })} label={text.notifications.reminders} />
        </Row>
        <Row title={text.notifications.lead_time}>
          <select className="settings-select" value={prefs.leadHours} disabled={!prefs.reminders} onChange={(event) => updatePrefs({ leadHours: Number(event.target.value) as LeadHours })}>
            {([1, 24, 72] as const).map((hours) => (
              <option key={hours} value={hours}>
                {text.notifications.leadOptions[hours]}
              </option>
            ))}
          </select>
        </Row>
        <Row
          title={text.notifications.browser}
          help={permission === 'unsupported' ? text.notifications.browserUnsupported : permission === 'denied' ? text.notifications.browserDenied : text.notifications.browserHelp}
        >
          <Switch checked={prefs.browser} disabled={permission === 'unsupported' || permission === 'denied'} onChange={(value) => void chooseBrowser(value)} label={text.notifications.browser} />
        </Row>
        <div className="settings-actions">
          <button className="company-button" type="button" onClick={() => notify({ id: `test:${Date.now()}`, kind: 'test', href: '#settings' })}>
            <i className="fa-regular fa-paper-plane" aria-hidden="true" /> {text.notifications.test}
          </button>
        </div>
      </Card>

      <CompanyRoleSettings />

    </div>
  );
}
