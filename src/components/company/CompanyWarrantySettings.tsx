// "Garantías de productos" in Configuración: the support email the buyer sees and the warranty length of the products
// this company issues. Saving applies them to every batch the company already has.
import { useEffect, useState, type SubmitEvent } from 'react';
import { storedUser } from '@/lib/client/account';
import { ACCOUNT_DATA_EVENT } from '@/lib/client/account-data';
import { refreshPublishedBrand } from '@/lib/client/brand';
import { COMPANY_PROFILE_EVENT, readCompanyProfile } from '@/lib/client/company-profile';
import { readWarrantySettings, saveWarrantySettings, WARRANTY_MONTH_OPTIONS, type WarrantyMonths } from '@/lib/client/warranty-settings';
import { currentWorkspace } from '@/lib/client/workspace';
import { errorMessage } from '@/lib/errors';
import { useCompanyText } from './CompanyText';

// Rendered inside the settings island, which provides the texts.
export function CompanyWarrantySettings() {
  const t = useCompanyText();
  const text = t.settings.warranty;
  const [email, setEmail] = useState('');
  const [months, setMonths] = useState<WarrantyMonths>(12);
  const [saved, setSaved] = useState<{ email: string; months: WarrantyMonths } | null>(null);
  const [company, setCompany] = useState('');
  const [editable, setEditable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const user = storedUser();
    // Also when the settings arrive from another browser of the account.
    const loadSettings = () => {
      const settings = readWarrantySettings();
      // Without settings yet, the contact email of the company profile is a good first guess.
      setEmail(settings?.email ?? readCompanyProfile().email);
      setMonths(settings?.warrantyMonths ?? 12);
      setSaved(settings ? { email: settings.email, months: settings.warrantyMonths } : null);
    };
    loadSettings();
    // The settings apply to the batches this account bought, so only its own company can change them.
    setEditable(Boolean(currentWorkspace(user)?.own));
    const loadCompany = () => setCompany(storedUser()?.companyName ?? '');
    loadCompany();
    window.addEventListener(COMPANY_PROFILE_EVENT, loadCompany);
    window.addEventListener(ACCOUNT_DATA_EVENT, loadSettings);
    return () => {
      window.removeEventListener(COMPANY_PROFILE_EVENT, loadCompany);
      window.removeEventListener(ACCOUNT_DATA_EVENT, loadSettings);
    };
  }, []);

  const dirty = !saved || saved.email !== email.trim().toLowerCase() || saved.months !== months;

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setNotice({ text: text.invalidEmail, tone: 'error' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const updated = await saveWarrantySettings({ email: normalized, warrantyMonths: months });
      setEmail(normalized);
      setSaved({ email: normalized, months });
      setNotice({ text: text.saved(updated), tone: 'success' });
      // The support email is part of the published brand: it follows, when there is one.
      void refreshPublishedBrand().catch((error: unknown) => {
        setNotice({ text: `${t.settings.brand.refreshFailed} ${errorMessage(error)}`, tone: 'error' });
      });
    } catch (error) {
      setNotice({ text: errorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="company-card settings-card company-warranty-settings" aria-labelledby="warranty-settings-title">
      <div className="settings-card-heading">
        <span className="settings-icon" aria-hidden="true">
          <i className="fa-solid fa-shield-heart" />
        </span>
        <div>
          <h2 id="warranty-settings-title">{text.title}</h2>
          <p>{text.lead}</p>
        </div>
      </div>
      {!editable && <p className="company-data-empty">{text.readOnly}</p>}
      {editable && !saved && (
        <p className="warranty-settings-missing">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {text.missing}
        </p>
      )}

      <form className="warranty-settings-layout" onSubmit={(event) => void submit(event)} noValidate>
        <div className="warranty-settings-fields">
          <label className="profile-field">
            <span>{text.email}</span>
            <input
              type="email"
              value={email}
              maxLength={254}
              placeholder={text.emailPlaceholder}
              disabled={!editable}
              onChange={(event) => {
                setEmail(event.target.value);
                setNotice(null);
              }}
            />
            <small className="profile-hint">{text.emailHelp}</small>
          </label>
          <div className="profile-field">
            <span id="warranty-months-label">{text.months}</span>
            <div className="warranty-months" role="radiogroup" aria-labelledby="warranty-months-label">
              {WARRANTY_MONTH_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={months === option}
                  disabled={!editable}
                  onClick={() => {
                    setMonths(option);
                    setNotice(null);
                  }}
                >
                  {text.monthOption(option)}
                </button>
              ))}
            </div>
            <small className="profile-hint">{text.monthsHelp}</small>
          </div>
          {editable && (
            <div className="settings-actions">
              <button type="submit" className="company-button is-primary" disabled={saving || !dirty}>
                <i className={`fa-solid ${saving ? 'fa-circle-notch fa-spin' : 'fa-check'}`} aria-hidden="true" /> {saving ? text.saving : text.save}
              </button>
              {notice && (
                <span className={notice.tone === 'success' ? 'settings-success' : 'settings-error'} role={notice.tone === 'error' ? 'alert' : 'status'}>
                  {notice.text}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="warranty-preview" aria-label={text.preview}>
          <span className="profile-label">{text.preview}</span>
          <div className="warranty-preview-card">
            <span className="warranty-preview-icon" aria-hidden="true">
              <i className="fa-solid fa-headset" />
            </span>
            <dl>
              <div>
                <dt>{text.previewCompany}</dt>
                <dd>{company || text.noCompany}</dd>
              </div>
              <div>
                <dt>{text.previewEmail}</dt>
                <dd className="is-email">{email.trim() || text.emailPlaceholder}</dd>
              </div>
            </dl>
          </div>
        </div>
      </form>
    </section>
  );
}
