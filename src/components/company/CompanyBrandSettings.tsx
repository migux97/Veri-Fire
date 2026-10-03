// "Marca para tus compradores" in Configuración: how the company shows on each warranty and whether it is published.
// Nothing here is published until the company presses the button.
import { useEffect, useState } from 'react';
import { IssuerBadge } from '@/components/ui/IssuerBadge';
import { ACCOUNT_DATA_EVENT } from '@/lib/client/account-data';
import type { PublicBrand } from '@/lib/brand';
import { currentBrand, brandStatus, publishBrand, readPublishedBrand, unpublishBrand, type BrandStatus, type PublishedBrand } from '@/lib/client/brand';
import { COMPANY_PROFILE_EVENT } from '@/lib/client/company-profile';
import { storedUser } from '@/lib/client/account';
import { currentWorkspace } from '@/lib/client/workspace';
import { errorMessage } from '@/lib/errors';
import { useCompanyText } from './CompanyText';

interface Notice {
  text: string;
  tone: 'success' | 'error';
}

const emptyBrand: PublicBrand = { name: '', website: '', description: '', supportEmail: '', supportPhone: '', logo: '' };

export function CompanyBrandSettings() {
  const t = useCompanyText();
  const text = t.settings.brand;
  // Empty until the page is in the browser: the server that renders it first has no storage to read them from.
  const [brand, setBrand] = useState<PublicBrand>(emptyBrand);
  const [published, setPublished] = useState<PublishedBrand | null>(null);
  const [status, setStatus] = useState<BrandStatus>('unpublished');
  const [editable, setEditable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Everything shown here comes from the profile, the support settings and the state of the publication: it is read
  // again whenever any of them changes, in this browser or in another one of the account.
  useEffect(() => {
    let active = true;
    const load = () => {
      setBrand(currentBrand());
      setPublished(readPublishedBrand());
      setEditable(Boolean(currentWorkspace(storedUser())?.own));
      void brandStatus().then((next) => active && setStatus(next));
    };
    load();
    window.addEventListener(COMPANY_PROFILE_EVENT, load);
    window.addEventListener(ACCOUNT_DATA_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(COMPANY_PROFILE_EVENT, load);
      window.removeEventListener(ACCOUNT_DATA_EVENT, load);
    };
  }, []);

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ text: await task(), tone: 'success' });
    } catch (error) {
      setNotice({ text: `${text.failed} ${errorMessage(error)}`, tone: 'error' });
    } finally {
      setBusy(false);
      setPublished(readPublishedBrand());
      void brandStatus().then(setStatus);
    }
  };

  const publish = () =>
    run(async () => {
      const wasPublished = Boolean(readPublishedBrand());
      await publishBrand();
      return wasPublished ? text.updatedDone : text.publishedDone;
    });

  const takeDown = () =>
    run(async () => {
      await unpublishBrand();
      return text.unpublishedDone;
    });

  const canPublish = editable && !busy && brand.name.trim().length > 0;
  const issuer = {
    name: brand.name.trim() || t.identity.unconfigured,
    logoUrl: brand.logo || null,
    website: brand.website || null,
    email: brand.supportEmail || null,
    phone: brand.supportPhone || null
  };

  return (
    <section className="company-card settings-card company-brand-settings" aria-labelledby="brand-settings-title">
      <div className="settings-card-heading">
        <span className="settings-icon" aria-hidden="true">
          <i className="fa-solid fa-store" />
        </span>
        <div>
          <h2 id="brand-settings-title">{text.title}</h2>
          <p>{text.lead}</p>
        </div>
      </div>
      {!editable && <p className="company-data-empty">{text.readOnly}</p>}

      <div className="brand-preview">
        <span className="profile-label">{text.preview}</span>
        <IssuerBadge issuer={issuer} labels={{ issuedBy: text.issuedBy, write: text.write, call: text.call }} />
        {!brand.supportEmail && <small className="profile-hint brand-warning">{text.noSupportEmail}</small>}
      </div>

      <div className="brand-publication">
        <span className={`brand-status is-${status}`} role="status">
          {text.status[status]}
        </span>
        {published && status !== 'unpublished' && <small className="profile-hint">{text.publishedAt(new Date(published.publishedAt).toLocaleDateString())}</small>}
        <div className="settings-actions">
          <button type="button" className="company-button is-primary" disabled={!canPublish || status === 'current'} onClick={() => void publish()}>
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-bullhorn'}`} aria-hidden="true" /> {busy ? text.working : status === 'unpublished' ? text.publish : text.update}
          </button>
          {status !== 'unpublished' && (
            <button type="button" className="company-button is-ghost" disabled={!editable || busy} onClick={() => void takeDown()}>
              {text.unpublish}
            </button>
          )}
        </div>
        {!brand.name.trim() && editable && <small className="profile-hint brand-warning">{text.needName}</small>}
      </div>


      {notice && (
        <p className={notice.tone === 'success' ? 'settings-success' : 'settings-error'} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
