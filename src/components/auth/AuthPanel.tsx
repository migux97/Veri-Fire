// Login and registration: Privy confirms the email (with a code) or the Google account and holds the user's Solana
// wallet, so there is no password nor key to manage here. What stays in this browser is the account and its session.
import { useEffect, useState } from 'react';
import { persistUser, storedUser, type StoredUser } from '@/lib/client/account';
import { pathAfterLogin } from '@/lib/client/after-login';
import { hasCompanyIntent, rememberCompanyIntent } from '@/lib/client/company-signup';
import { privyBridge, type PrivyLogin } from '@/lib/client/privy-registry';
import { hasPendingClaim } from '@/lib/client/qr';
import { userSession, type SessionEndReason } from '@/lib/client/session';
import { rememberWallet } from '@/lib/client/wallet';
import { errorMessage } from '@/lib/errors';

type NoticeTone = 'info' | 'success' | 'error';

const SESSION_NOTICES: Record<SessionEndReason, string> = {
  expirada: 'Tu sesión expiró por seguridad. Iniciá sesión nuevamente.',
  cerrada: 'Tu sesión se cerró. Iniciá sesión cuando quieras volver.',
  verificar: 'Para registrar tu garantía necesitamos confirmar tu correo. Iniciá sesión de nuevo.'
};

// A company account stays a company account: its type and name are kept in this browser, by email.
const userFromLogin = ({ email, name, address }: PrivyLogin): StoredUser => {
  if (!email) throw new Error('Tu cuenta necesita un correo. Entrá con tu correo o con una cuenta de Google que lo tenga.');
  const existing = storedUser();
  const sameAccount = existing?.email?.toLowerCase() === email.toLowerCase();
  return {
    name: name || (sameAccount && existing?.name) || email.split('@')[0] || 'Usuario',
    email,
    walletAddress: address,
    emailVerifiedAt: Date.now(),
    ...(sameAccount && existing?.accountType ? { accountType: existing.accountType } : {}),
    ...(sameAccount && existing?.companyName ? { companyName: existing.companyName } : {})
  };
};

interface AuthPanelProps {
  privyAppId: string;
}

export function AuthPanel({ privyAppId }: AuthPanelProps) {
  const [busy, setBusy] = useState(false);
  const [forCompany, setForCompany] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone }>({ text: '', tone: 'info' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // "Registrar mi empresa": kept through the login, so the company comes next.
    if (params.get('para') === 'empresa') rememberCompanyIntent();
    setForCompany(hasCompanyIntent());
    const reason = params.get('sesion');
    if (reason && reason in SESSION_NOTICES) {
      setNotice({ text: SESSION_NOTICES[reason as SessionEndReason], tone: 'info' });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (hasPendingClaim()) {
      setNotice({ text: 'Escaneaste el QR de un producto. Iniciá sesión para activar su garantía.', tone: 'info' });
    }
  }, []);

  const enter = async () => {
    setBusy(true);
    setNotice({ text: '', tone: 'info' });
    try {
      const user = userFromLogin(await (await privyBridge()).login());
      persistUser(user);
      rememberWallet(user.walletAddress);
      userSession.start(user.email);
      setNotice({ text: 'Sesión iniciada correctamente. Redirigiendo...', tone: 'success' });
      // Replaces the login page in the history, so going back from the panel does not land on it again.
      window.setTimeout(() => {
        window.location.replace(pathAfterLogin(user));
      }, 700);
    } catch (error) {
      setNotice({ text: errorMessage(error), tone: 'error' });
      setBusy(false);
    }
  };

  if (!privyAppId) {
    return <p className="auth-message error">Configurá PRIVY_APP_ID con el App ID de Privy (dashboard.privy.io) para iniciar sesión.</p>;
  }

  return (
    <>
      <div className="auth-form">
        <p className="auth-guide">
          {forCompany
            ? 'Entrá con tu correo o con Google para registrar tu empresa. Tu wallet de Solana se crea sola, sin comisiones.'
            : 'Entrá con tu correo o con Google. Si es tu primera vez, tu cuenta y tu wallet de Solana se crean solas, sin comisiones.'}
        </p>
        <button type="button" className="button button-primary auth-submit" disabled={busy} onClick={() => void enter()}>
          {busy ? 'Abriendo el acceso...' : 'Entrar a Verifire'}
        </button>
      </div>
      <p className={notice.text ? `auth-message ${notice.tone}` : 'auth-message'} aria-live="polite">{notice.text}</p>
    </>
  );
}
