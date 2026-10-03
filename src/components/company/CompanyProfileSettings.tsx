// "Perfil de empresa" in Configuración: the logo and the company's data, with a live preview of the sidebar card.
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type SubmitEvent } from 'react';
import { storedUser } from '@/lib/client/account';
import { refreshPublishedBrand } from '@/lib/client/brand';
import { isPhone, isWebsite } from '@/lib/brand';
import { errorMessage } from '@/lib/errors';
import { companyName, emptyProfile, prepareLogo, readCompanyProfile, saveCompanyProfile, type CompanyProfile, type LogoError } from '@/lib/client/company-profile';
import { currentWorkspace } from '@/lib/client/workspace';
import { useCompanyText } from './CompanyText';

const DESCRIPTION_MAX = 280;
const INDUSTRIES = ['', 'electronics', 'cosmetics', 'watches', 'beverages', 'automotive', 'apparel', 'pharma', 'other'];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'VF';

type TextField = Exclude<keyof CompanyProfile, 'logo' | 'industry' | 'description'>;

// Rendered inside the settings island, which provides the texts.
export function CompanyProfileSettings() {
  const t = useCompanyText();
  const text = t.settings.profile;
  const [saved, setSaved] = useState<{ name: string; profile: CompanyProfile }>({ name: '', profile: emptyProfile });
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<CompanyProfile>(emptyProfile);
  const [editable, setEditable] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loadingLogo, setLoadingLogo] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const user = storedUser();
    // The profile edited here is the account's own company: a team the account joined keeps its profile elsewhere.
    const current = { name: companyName(), profile: readCompanyProfile() };
    setSaved(current);
    setName(current.name);
    setProfile(current.profile);
    setEditable(Boolean(currentWorkspace(user)?.own));
  }, []);

  const dirty = name !== saved.name || JSON.stringify(profile) !== JSON.stringify(saved.profile);
  const update = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
    setNotice(null);
  };

  const loadLogo = async (file: File | undefined) => {
    if (!file || !editable) return;
    setLoadingLogo(true);
    try {
      update('logo', await prepareLogo(file));
    } catch (error) {
      const reason = (error instanceof Error ? error.message : 'read') as LogoError;
      setNotice({ text: text.logoErrors[reason] ?? text.logoErrors.read, tone: 'error' });
    } finally {
      setLoadingLogo(false);
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    void loadLogo(event.target.files?.[0]);
    // The same file can be chosen again after removing it.
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void loadLogo(event.dataTransfer.files[0]);
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, key === 'logo' ? value : value.trim()])) as unknown as CompanyProfile;
    const tradeName = name.trim();
    if (!tradeName) return setNotice({ text: text.invalidName, tone: 'error' });
    if (trimmed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) return setNotice({ text: text.invalidEmail, tone: 'error' });
    if (trimmed.website && !isWebsite(trimmed.website)) return setNotice({ text: text.invalidWebsite, tone: 'error' });
    if (trimmed.supportPhone && !isPhone(trimmed.supportPhone)) return setNotice({ text: text.invalidPhone, tone: 'error' });
    if (!saveCompanyProfile(trimmed, tradeName)) return setNotice({ text: text.saveFailed, tone: 'error' });
    setSaved({ name: tradeName, profile: trimmed });
    setName(tradeName);
    setProfile(trimmed);
    setNotice({ text: text.saved, tone: 'success' });
    // A brand that was already published follows what was just saved; one that was not stays private.
    void refreshPublishedBrand().catch((error: unknown) => {
      setNotice({ text: `${t.settings.brand.refreshFailed} ${errorMessage(error)}`, tone: 'error' });
    });
  };

  const field = (key: TextField, type = 'text', maxLength = 120) => (
    <label className="profile-field">
      <span>{text.fields[key]}</span>
      <input
        type={type}
        value={profile[key]}
        maxLength={maxLength}
        placeholder={text.placeholders[key]}
        disabled={!editable}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );

  return (
    <section className="company-card settings-card company-profile-settings" aria-labelledby="profile-settings-title">
      <div className="settings-card-heading">
        <span className="settings-icon" aria-hidden="true">
          <i className="fa-solid fa-building" />
        </span>
        <div>
          <h2 id="profile-settings-title">{text.title}</h2>
          <p>{text.lead}</p>
        </div>
      </div>
      {!editable && <p className="company-data-empty">{text.readOnly}</p>}

      <form className="profile-layout" onSubmit={submit} noValidate>
        <div className="profile-logo-column">
          <span className="profile-label">{text.logo}</span>
          <div
            className={`profile-logo-drop ${dragging ? 'is-dragging' : ''} ${profile.logo ? 'has-logo' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (editable) setDragging(true);
            }}
            onDragLeave={(event) => {
              // Moving over the image inside the drop zone also fires dragleave: only leaving the zone counts.
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={onDrop}
          >
            {profile.logo ? (
              <img src={profile.logo} alt="" width={120} height={120} />
            ) : (
              <span className="profile-logo-placeholder" aria-hidden="true">
                {loadingLogo ? <i className="fa-solid fa-circle-notch fa-spin" /> : initials(name)}
              </span>
            )}
            {dragging && <span className="profile-logo-overlay">{text.drop}</span>}
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" hidden onChange={onFile} />
          <div className="profile-logo-actions">
            <button type="button" className="company-button is-small" disabled={!editable || loadingLogo} onClick={() => fileInput.current?.click()}>
              <i className="fa-solid fa-arrow-up-from-bracket" aria-hidden="true" /> {profile.logo ? text.change : text.upload}
            </button>
            {profile.logo && (
              <button type="button" className="company-button is-ghost is-small" disabled={!editable} onClick={() => update('logo', '')}>
                {text.remove}
              </button>
            )}
          </div>
          <small className="profile-hint">{text.logoHint}</small>

          <div className="profile-preview">
            <span className="profile-label">{text.preview}</span>
            <div className="company-workspace">
              <span className={`company-workspace-mark ${profile.logo ? 'has-logo' : ''}`} aria-hidden="true">
                {profile.logo ? <img src={profile.logo} alt="" /> : initials(name)}
              </span>
              <span className="company-workspace-text">
                <span className="company-workspace-label">{t.identity.organization}</span>
                <strong>{name.trim() || t.identity.unconfigured}</strong>
                <span className="company-workspace-meta">
                  {t.identity.business} · {t.roles.admin}
                </span>
              </span>
            </div>
            <small className="profile-hint">{text.previewHint}</small>
          </div>
        </div>

        <div className="profile-fields">
          <label className="profile-field">
            <span>{text.fields.name}</span>
            <input value={name} maxLength={100} placeholder={text.placeholders.name} disabled={!editable} required onChange={(event) => {
              setName(event.target.value);
              setNotice(null);
            }} />
          </label>
          {field('legalName')}
          {field('taxId', 'text', 40)}
          <label className="profile-field">
            <span>{text.fields.industry}</span>
            <select value={profile.industry} disabled={!editable} onChange={(event) => update('industry', event.target.value)}>
              {INDUSTRIES.map((value) => (
                <option key={value} value={value}>
                  {text.industries[value]}
                </option>
              ))}
            </select>
          </label>
          {field('website', 'url', 200)}
          {field('email', 'email', 160)}
          {field('phone', 'tel', 40)}
          {field('supportPhone', 'tel', 40)}
          {field('country', 'text', 80)}
          <div className="profile-field-wide">{field('address', 'text', 200)}</div>
          <label className="profile-field profile-field-wide">
            <span>
              {text.fields.description}
              <em>{text.counter(profile.description.length, DESCRIPTION_MAX)}</em>
            </span>
            <textarea
              value={profile.description}
              maxLength={DESCRIPTION_MAX}
              rows={3}
              placeholder={text.placeholders.description}
              disabled={!editable}
              onChange={(event) => update('description', event.target.value)}
            />
          </label>
          {editable && (
            <div className="settings-actions profile-field-wide">
              <button type="submit" className="company-button is-primary" disabled={!dirty}>
                <i className="fa-solid fa-check" aria-hidden="true" /> {text.save}
              </button>
              <button
                type="button"
                className="company-button is-ghost"
                disabled={!dirty}
                onClick={() => {
                  setName(saved.name);
                  setProfile(saved.profile);
                  setNotice(null);
                }}
              >
                {text.discard}
              </button>
              {notice && (
                <span className={notice.tone === 'success' ? 'settings-success' : 'settings-error'} role={notice.tone === 'error' ? 'alert' : 'status'}>
                  {notice.text}
                </span>
              )}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
