// /verificacion: the administrators of Verifire review the companies and decide. It needs the signature of a wallet listed
// in ADMIN_WALLETS: the server refuses everything else, so what this page shows is only a convenience.
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/client/api';
import { approveCompany, listCompaniesForReview, rejectCompany } from '@/lib/client/verification';
import { userSession } from '@/lib/client/session';
import { errorMessage } from '@/lib/errors';
import type { CompanyForReview } from '@/lib/types';
import { VerificationList, type Decision } from './VerificationList';

type Phase = 'loading' | 'denied' | 'ready' | 'error';

export function VerificationAdmin() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [companies, setCompanies] = useState<CompanyForReview[]>([]);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setPhase('loading');
    try {
      setCompanies(await listCompaniesForReview());
      setPhase('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setPhase('denied');
        return;
      }
      setMessage(errorMessage(error));
      setPhase('error');
    }
  };

  useEffect(() => {
    if (userSession.isActive()) void load();
  }, []);

  // Each decision is signed on its own; the list is read again afterwards, so it shows what the server kept.
  const decide = async (task: () => Promise<unknown>, done: string) => {
    await task();
    setNotice(done);
    setCompanies(await listCompaniesForReview());
  };

  const decision: Decision = {
    approve: (company, { name, domain }) => decide(() => approveCompany(company.owner, { name, domain }), `${name} quedó verificada.`),
    reject: (company, note) => decide(() => rejectCompany(company.owner, note), `${company.companyName || 'La empresa'} quedó sin verificación.`)
  };

  if (phase === 'loading') return <p className="vadmin-status" role="status">Leyendo las empresas… Tu billetera firma el pedido.</p>;
  if (phase === 'denied') {
    return (
      <p className="vadmin-status is-denied" role="alert">
        Tu cuenta no administra Verifire. Las billeteras que pueden verificar empresas se definen en el servidor (<code>ADMIN_WALLETS</code>).
      </p>
    );
  }
  if (phase === 'error') {
    return (
      <div className="vadmin-status is-denied" role="alert">
        <p>No se pudo leer la lista: {message}</p>
        <button type="button" className="button button-secondary" onClick={() => void load()}>Reintentar</button>
      </div>
    );
  }
  return (
    <>
      {notice && <p className="vadmin-notice" role="status">{notice}</p>}
      <VerificationList companies={companies} decision={decision} />
    </>
  );
}
