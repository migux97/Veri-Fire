// "Verificación de la empresa" in Configuración: where the company stands, and the request. Verifire decides by hand: the
// company only asks. Until it is verified, what a buyer scans says the product is "registered", never "original".
import { useEffect, useState } from 'react';
import { ACCOUNT_DATA_EVENT } from '@/lib/client/account-data';
import { storedUser } from '@/lib/client/account';
import { COMPANY_PROFILE_EVENT, emptyProfile, readCompanyProfile } from '@/lib/client/company-profile';
import { readVerification, requestVerification, VERIFICATION_EVENT } from '@/lib/client/verification';
import { currentWorkspace } from '@/lib/client/workspace';
import { errorMessage } from '@/lib/errors';
import type { VerificationState } from '@/lib/types';
import { useCompanyText } from './CompanyText';

type Kind = 'none' | 'pending' | 'verified' | 'rejected' | 'paused';

const kindOf = (state: VerificationState | null): Kind => {
  if (!state || state.status === 'none') return 'none';
  if (state.status === 'verified') return state.active ? 'verified' : 'paused';
  return state.status;
};

export function CompanyVerification() {
  const t = useCompanyText();
  const text = t.settings.verification;
  // Empty until the page is in the browser: the server that renders it first has no storage to read them from.
  const [state, setState] = useState<VerificationState | null>(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [editable, setEditable] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const load = () => {
      setState(readVerification());
      setProfile(readCompanyProfile());
      setEditable(Boolean(currentWorkspace(storedUser())?.own));
    };
    load();
    window.addEventListener(VERIFICATION_EVENT, load);
    window.addEventListener(COMPANY_PROFILE_EVENT, load);
    window.addEventListener(ACCOUNT_DATA_EVENT, load);
    return () => {
      window.removeEventListener(VERIFICATION_EVENT, load);
      window.removeEventListener(COMPANY_PROFILE_EVENT, load);
      window.removeEventListener(ACCOUNT_DATA_EVENT, load);
    };
  }, []);

  const kind = kindOf(state);
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(t.intl, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  // What whoever reviews needs in front of them: the company's own data, from its profile.
  const needs = [
    ['legalName', profile.legalName, true],
    ['taxId', profile.taxId, true],
    ['website', profile.website, false],
    ['email', profile.email, false]
  ] as const;
  const complete = Boolean(profile.legalName.trim() && profile.taxId.trim());
  const canAsk = editable && !busy && complete && (kind === 'none' || kind === 'rejected' || kind === 'paused');

  const ask = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await requestVerification(message.trim());
      setMessage('');
      setNotice({ text: text.requested, tone: 'success' });
    } catch (error) {
      setNotice({ text: `${text.failed} ${errorMessage(error)}`, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="company-card settings-card company-verification" aria-labelledby="verification-settings-title">
      <div className="settings-card-heading">
        <span className="settings-icon" aria-hidden="true">
          <i className="fa-solid fa-shield-halved" />
        </span>
        <div>
          <h2 id="verification-settings-title">{text.title}</h2>
          <p>{text.lead}</p>
        </div>
      </div>
      {!editable && <p className="company-data-empty">{text.readOnly}</p>}

      <span className={`verify-status is-${kind}`} role="status">
        <i className={`fa-solid ${kind === 'verified' ? 'fa-circle-check' : kind === 'pending' ? 'fa-hourglass-half' : kind === 'rejected' ? 'fa-circle-xmark' : kind === 'paused' ? 'fa-pause' : 'fa-circle-question'}`} aria-hidden="true" /> {text.status[kind]}
      </span>

      {kind === 'verified' && state?.name && (
        <p className="verify-status-text">
          {text.verifiedText(state.name)}
          {state.domain && <> {text.domain(state.domain)}.</>}
        </p>
      )}
      {kind === 'paused' && state?.name && <p className="verify-status-text">{text.pausedText(state.name)}</p>}
      {kind === 'pending' && <p className="verify-status-text">{text.pendingText(date(state?.requestedAt))}</p>}
      {kind === 'rejected' && (
        <p className="verify-status-text">
          {text.rejectedText}
          {state?.note && <> <strong>{text.reason}:</strong> {state.note}</>}
        </p>
      )}

      {(kind === 'none' || kind === 'rejected' || kind === 'paused') && editable && (
        <div className="verify-request">
          <span className="profile-label">{text.checklist}</span>
          <ul className="verify-checklist">
            {needs.map(([key, value, required]) => (
              <li key={key} className={value.trim() ? 'is-done' : ''}>
                <i className={`fa-solid ${value.trim() ? 'fa-check' : 'fa-minus'}`} aria-hidden="true" /> {text.needs[key]}
                {!required && <small> ({text.optional})</small>}
              </li>
            ))}
          </ul>
          {!complete && <small className="profile-hint brand-warning">{text.needProfile}</small>}
          <label className="verify-request-message">
            <span className="profile-label">{text.message}</span>
            <textarea value={message} maxLength={500} rows={3} placeholder={text.messagePlaceholder} onChange={(event) => setMessage(event.currentTarget.value)} />
          </label>
          <div className="settings-actions">
            <button type="button" className="company-button is-primary" disabled={!canAsk} onClick={() => void ask()}>
              <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`} aria-hidden="true" /> {busy ? text.working : kind === 'none' ? text.request : text.requestAgain}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className={notice.tone === 'success' ? 'settings-success' : 'settings-error'} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
