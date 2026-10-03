// Login, registration and the email code. The account is kept in this browser; Cavos verifies the email and holds the
// Stellar wallet.
import type { CavosAuth, Identity } from '@cavos/kit';
import { useEffect, useRef, useState } from 'react';
import { persistUser, storedUser, type StoredUser } from '@/lib/client/account';
import { describeAuthError, googleCallbackUrl, PENDING_CAVOS_AUTH_KEY, sendEmailCode, sendRecoveryLink, verifyEmailCode } from '@/lib/client/email-code';
import { deviceCodeFor, hashPassword, verifyPassword } from '@/lib/client/password';
import { GooglePasswordForm, type GooglePasswordKind } from './GooglePasswordForm';
import { hasPendingClaim } from '@/lib/client/qr';
import { userSession, type SessionEndReason } from '@/lib/client/session';
import { readStored, writeStored } from '@/lib/client/storage';
import { connectCavosWallet, createCavosAuth, enableAnywhereRecovery, keyBackupState, rememberDeviceCode, rememberWallet, resetKeyPassword, WRONG_CURRENT_PASSWORD } from '@/lib/client/wallet';
import { socialRecoveryConfig } from '@/lib/client/social-recovery';
import { postJson } from '@/lib/client/api';
import { pathAfterLogin } from '@/lib/client/after-login';
import { hasCompanyIntent, rememberCompanyIntent } from '@/lib/client/company-signup';
import { errorMessage } from '@/lib/errors';
import { isStellarAddress } from '@/lib/validation';
import { EmailCodeForm, type VerificationKind } from './EmailCodeForm';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ResetPasswordForm } from './ResetPasswordForm';
import { useResendCooldown } from './useResendCooldown';

type AuthMode = 'login' | 'register' | 'reset';
type NoticeTone = 'info' | 'success' | 'error';

interface Notice {
  text: string;
  tone: NoticeTone;
}

interface PendingVerification {
  auth: CavosAuth;
  nonce?: unknown;
  email: string;
  user: StoredUser;
  mode: AuthMode;
  newDevice: boolean;
  deviceCode?: string;
  // Set once the email code was accepted: a wrong password is typed again without asking for another code.
  identity?: Identity;
  // The password typed is not the one this browser knows: it was changed on another device (see confirmNewPassword).
  changed?: boolean;
  // Reset on a device without the key, for an account not sealed in the enclave: the device code of the current
  // password, which opens the copy of the key kept in Stellar.
  currentCode?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;
// The email is confirmed with a code on registration and again on the first login after this long.
const EMAIL_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_GOOGLE_KEY = PENDING_CAVOS_AUTH_KEY;

const SESSION_NOTICES: Record<SessionEndReason, Notice> = {
  expirada: { text: 'Tu sesión expiró por seguridad. Iniciá sesión nuevamente.', tone: 'info' },
  cerrada: { text: 'Tu sesión se cerró. Iniciá sesión cuando quieras volver.', tone: 'success' },
  verificar: { text: 'Para registrar tu garantía en Stellar necesitamos confirmar tu correo. Iniciá sesión y te enviaremos un código.', tone: 'info' }
};

// Whether an email already has an account: the one kept in this browser, or one the server knows about. Without an
// answer from the server the registration goes on, as it did before this check.
const emailHasAccount = async (email: string) => {
  if (storedUser()?.email?.toLowerCase() === email.toLowerCase()) return true;
  try {
    return (await postJson<{ registered: boolean }>('/api/accounts/exists', { email }, '')).registered;
  } catch {
    return false;
  }
};

const inputOf = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | null;

const verificationKind = ({ newDevice, mode, changed }: PendingVerification): VerificationKind =>
  mode === 'reset' ? 'reset' : changed ? 'password-changed' : newDevice ? 'new-device' : mode === 'login' ? 'login' : 'register';

// The new password was fine, but this browser does not hold the account's key, so it cannot save it again. With Cavos'
// recovery on, it means the account was never enrolled in it: that happens on a device that holds the key.
const RESET_NOT_ENROLLED = 'Tu correo quedó confirmado, pero tu cuenta todavía no tiene activada la recuperación desde cualquier dispositivo. Se activa sola cuando cambiás la contraseña (o entrás con Google) desde el dispositivo donde ya usás Verifire. Hacelo ahí una vez y después vas a poder recuperarla desde cualquier lado.';
// Neither this device, nor the enclave, nor a copy sealed with a password: only the device that created the account
// holds the key.
const RESET_LOST = 'Tu correo quedó confirmado, pero la llave de tu wallet solo está en el dispositivo y el navegador donde creaste la cuenta, y todavía no tiene ningún respaldo. Entrá a Verifire desde ahí (con la misma dirección que usabas) y activá la recuperación en "Mis garantías".';
const RESET_OTHER_DEVICE = 'Tu correo quedó confirmado, pero este navegador no puede cambiar la contraseña: la llave de tu wallet está guardada con tu contraseña anterior, que Verifire no conoce. Hacelo desde un dispositivo donde ya hayas entrado a tu cuenta (tu computadora o tu celular de siempre) y después vas a poder entrar desde cualquiera con la contraseña nueva.';

const googleUserFromIdentity = (identity: Identity): StoredUser => {
  const email = identity.email ?? '';
  if (!EMAIL_PATTERN.test(email)) throw new Error('La cuenta de Google debe incluir una dirección de correo válida.');
  const existingUser = storedUser();
  const sameAccount = existingUser?.email?.toLowerCase() === email.toLowerCase();
  return {
    name: identity.name || (sameAccount && existingUser?.name) || 'Usuario de Google',
    email,
    passwordHash: sameAccount ? existingUser?.passwordHash : undefined,
    provider: 'google',
    // A company account that signs in with Google stays a company account: without these the panel sent it to the
    // buyer's view and the company panel turned it away.
    ...(sameAccount && existingUser?.accountType ? { accountType: existingUser.accountType } : {}),
    ...(sameAccount && existingUser?.companyName ? { companyName: existingUser.companyName } : {}),
    // A Google login has no password to enable the multi-device factor: it keeps the one a password login saved.
    ...(sameAccount && existingUser?.deviceFactorAt ? { deviceFactorAt: existingUser.deviceFactorAt } : {})
  };
};

interface AuthPanelProps {
  cavosAppId: string;
}

export function AuthPanel({ cavosAppId }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [verification, setVerification] = useState<{ kind: VerificationKind; email: string } | null>(null);
  const [notice, setNotice] = useState<Notice>({ text: '', tone: 'info' });
  const [submitting, setSubmitting] = useState<AuthMode | null>(null);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [savedUsername, setSavedUsername] = useState('');
  const [forCompany, setForCompany] = useState(false);
  // An email typed in the registration that already has an account, and the one the login form starts from.
  const [registered, setRegistered] = useState<string | null>(null);
  const [loginPrefill, setLoginPrefill] = useState('');
  // The email the password recovery starts from.
  const [resetEmail, setResetEmail] = useState('');
  // Cavos' recovery enclave is on for this app: the password can be reset from any device.
  const [anyDevice, setAnyDevice] = useState(false);
  // The recovery link was sent to this email: this browser waits for it to be opened, here or anywhere else.
  const [linkSent, setLinkSent] = useState<string | null>(null);
  // A password this browser does not know for its own account, kept in memory only while the login offers to confirm
  // it with a code (it was changed on another device).
  const [changedPassword, setChangedPassword] = useState<string | null>(null);
  // Signed in with Google, and the account's key still has to be saved (or opened) with its Verifire password.
  const [googlePassword, setGooglePassword] = useState<{ kind: GooglePasswordKind; email: string } | null>(null);
  const [googleSaving, setGoogleSaving] = useState(false);
  const pending = useRef<PendingVerification | null>(null);
  // Set synchronously: a pasted code submits on its own, and a second submit may come before the next render.
  const codeInFlight = useRef(false);
  const cooldown = useResendCooldown();

  const showNotice = (text: string, tone: NoticeTone = 'info') => setNotice({ text, tone });

  const requestEmailCode = async (email: string) => {
    if (!cavosAppId) throw new Error('Configurá CAVOS_APP_ID con el App ID real de Cavos antes de verificar el correo.');
    const auth = await createCavosAuth(cavosAppId);
    showNotice('Enviando un código a tu correo...');
    const nonce = await sendEmailCode(auth, email);
    return { auth, nonce };
  };

  const openVerification = (verificationToOpen: PendingVerification, { resetCooldown = true } = {}) => {
    pending.current = verificationToOpen;
    setVerification({ kind: verificationKind(verificationToOpen), email: verificationToOpen.email });
    showNotice('');
    // Coming back to a code that was already sent keeps its countdown instead of starting a new one.
    if (resetCooldown) cooldown.start();
  };

  // Opens the panel for a verified account. The wallet address and the verification date are saved in the account
  // when the email is verified, so logins in the next 7 days only need the password.
  const enterApp = (user: StoredUser, loginMode: AuthMode, warning = '') => {
    persistUser(user);
    rememberWallet(user.walletAddress);
    userSession.start(user.email);
    // A warning (for example, a device that cannot sign yet) is readable before the panel opens.
    const done = loginMode === 'reset' ? 'Listo: tu contraseña cambió. Redirigiendo...' : loginMode === 'login' ? 'Sesión iniciada correctamente. Redirigiendo...' : 'Cuenta creada correctamente. Redirigiendo...';
    showNotice(warning || done, warning ? 'info' : 'success');
    window.setTimeout(() => {
      window.location.href = pathAfterLogin(user);
    }, warning ? 3200 : 700);
  };

  // False when the password did not open the account's key: the user is back at the form to type it again.
  const finishAuthFlow = async (identity: Identity) => {
    const current = pending.current;
    if (!current) throw new Error('La verificación expiró. Iniciá el proceso nuevamente.');
    const { user, mode: loginMode, auth, deviceCode } = current;
    if (identity.email && identity.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new Error('La verificación de Cavos corresponde a otro correo. Iniciá el proceso nuevamente.');
    }
    if (loginMode === 'reset') {
      let reset;
      try {
        reset = await resetKeyPassword(cavosAppId, auth, identity, deviceCode ?? '', current.currentCode);
      } catch (error) {
        // A mistyped current password is typed again: the email stays confirmed.
        if (errorMessage(error) === WRONG_CURRENT_PASSWORD) throw error;
        throw new Error(`${errorMessage(error)} Pedí un código o un enlace nuevo para volver a intentar.`);
      }
      if (!reset.ok && reset.needsCurrent && !current.currentCode) {
        // The current password opens the copy of the key kept in Stellar: it is asked for, and the reset goes on.
        setVerification(null);
        setGooglePassword({ kind: 'current', email: current.email });
        showNotice('');
        return false;
      }
      pending.current = null;
      if (!reset.ok) {
        // Nothing changed: the account keeps its old password everywhere.
        setVerification(null);
        setGooglePassword(null);
        setMode('reset');
        showNotice(reset.needsCurrent ? (anyDevice ? RESET_NOT_ENROLLED : RESET_OTHER_DEVICE) : RESET_LOST, 'error');
        return false;
      }
      enterApp({
        ...user,
        walletAddress: reset.address,
        cavosUserId: identity.userId,
        emailVerifiedAt: Date.now(),
        deviceFactorAt: Date.now()
      }, 'reset');
      return true;
    }
    // Cavos already accepted the code, and a code is single-use: only Cavos failing to return the wallet is fatal
    // here. A device that could not be enabled to sign gets in anyway, with the reason shown.
    let connection;
    try {
      connection = await connectCavosWallet(cavosAppId, auth, identity, deviceCode);
    } catch (error) {
      throw new Error(`${errorMessage(error)} Ese código ya fue usado: pedí uno nuevo para volver a intentar.`);
    }
    if (connection.wrongPassword) {
      pending.current = { ...current, identity };
      setVerification(null);
      setMode(current.mode);
      showNotice(connection.deviceError, 'error');
      return false;
    }
    pending.current = null;
    // Starts the 7 days during which logging in only needs the password. The Cavos user id lets the panel reconnect
    // the same wallet to sign on Stellar after a password-only login (see connectSigningWallet).
    enterApp({
      ...user,
      walletAddress: connection.address,
      cavosUserId: identity.userId,
      emailVerifiedAt: Date.now(),
      deviceFactorAt: connection.deviceFactor ? Date.now() : (user.deviceFactorAt ?? 0)
    }, loginMode, connection.deviceError);
    return true;
  };

  const handleAuthSubmit = async (formMode: AuthMode, form: HTMLFormElement) => {
    const identifierField = inputOf(form, formMode === 'register' ? 'email' : 'identifier');
    const passwordField = inputOf(form, 'password');
    const confirmField = formMode === 'register' ? inputOf(form, 'passwordConfirm') : null;
    const username = formMode === 'register' ? inputOf(form, 'username')?.value.trim() ?? '' : '';
    const identifier = identifierField?.value.trim() ?? '';
    const password = passwordField?.value.trim() ?? '';

    if (!identifier || !password) {
      showNotice('Completa tu nombre de usuario o correo y tu contraseña para continuar.', 'error');
      return;
    }
    if (formMode === 'register' && !EMAIL_PATTERN.test(identifier)) {
      showNotice('Usá una dirección de correo válida.', 'error');
      identifierField?.focus();
      return;
    }
    if (!PASSWORD_PATTERN.test(password)) {
      showNotice('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.', 'error');
      passwordField?.focus();
      return;
    }
    if (confirmField && confirmField.value.trim() !== password) {
      showNotice('Las contraseñas no coinciden. Escribí la misma contraseña en los dos campos.', 'error');
      confirmField.focus();
      return;
    }
    if (formMode === 'register' && !username) {
      showNotice('Ingresa un nombre de usuario para crear tu cuenta.', 'error');
      return;
    }

    const existingUser = storedUser();
    // Accounts live in each browser. On a new device (a phone that scanned a QR) signing in with the email and its
    // code rebuilds the account here, and Cavos returns the same wallet, so the warranties are the same ones.
    const newDevice = formMode === 'login' && EMAIL_PATTERN.test(identifier)
      && existingUser?.email?.toLowerCase() !== identifier.toLowerCase();

    if (formMode === 'login' && !newDevice) {
      if (!existingUser) {
        showNotice('En este navegador todavía no hay ninguna cuenta. Ingresá con tu correo y te enviamos un código para recuperarla, o creá una cuenta nueva.', 'error');
        return;
      }
      const matchesUsername = existingUser.name?.toLowerCase() === identifier.toLowerCase();
      const matchesEmail = existingUser.email?.toLowerCase() === identifier.toLowerCase();
      if (!matchesUsername && !matchesEmail) {
        showNotice('El nombre de usuario, correo o contraseña no coinciden.', 'error');
        return;
      }
    }

    setSubmitting(formMode);
    setRegistered(null);
    let redirecting = false;
    try {
      // Registering again with an email that has an account would create nothing new (its wallet is always the same)
      // and end in a password error after the code: it is sent to the login instead, before any code is sent.
      if (formMode === 'register' && (await emailHasAccount(identifier))) {
        setRegistered(identifier);
        showNotice('');
        return;
      }
      let user: StoredUser;
      if (formMode === 'register') {
        // Everybody registers as a person; a company is created afterwards (see company-signup.ts).
        user = { name: username, email: identifier, passwordHash: await hashPassword(password) };
      } else if (newDevice) {
        // The code sent to the email is what proves who this is; the password is only this device's local gate.
        user = { name: identifier.split('@')[0] ?? identifier, email: identifier, passwordHash: await hashPassword(password) };
      } else {
        if (!existingUser || !(await verifyPassword(existingUser, password))) {
          // It may be right: a password changed from a recovery link on another device is unknown here.
          if (existingUser) setChangedPassword(password);
          showNotice('El nombre de usuario, correo o contraseña no coinciden.', 'error');
          return;
        }
        const { password: legacyPassword, ...account } = existingUser;
        user = account;
        if (legacyPassword) {
          user = { ...account, passwordHash: await hashPassword(password) };
          persistUser(user);
        }
        // The email is confirmed with a code when the account is created and again every 7 days; in between, logging
        // in only needs the password.
        const emailRecentlyVerified = Date.now() - Number(user.emailVerifiedAt || 0) < EMAIL_CHECK_INTERVAL_MS;
        // An account created before the multi-device factor existed is asked for the code once, so entering it is
        // enough on any other device from then on.
        if (isStellarAddress(user.walletAddress) && emailRecentlyVerified && user.deviceFactorAt) {
          // Kept for this tab so the panel can repair an account whose multi-device access was never saved.
          rememberDeviceCode(await deviceCodeFor(user.email, password));
          redirecting = true;
          enterApp(user, 'login');
          return;
        }
      }

      const deviceCode = await deviceCodeFor(user.email, password);
      // The email was already confirmed and only the password was wrong: this one is tried with the same code.
      const confirmed = pending.current?.email === user.email ? pending.current.identity : undefined;
      if (confirmed && pending.current) {
        pending.current = { ...pending.current, user, mode: formMode, newDevice, deviceCode };
        showNotice('Comprobando la contraseña...');
        redirecting = await finishAuthFlow(confirmed);
        return;
      }
      // A code already sent to this address stays valid: reuse it instead of asking Cavos for another one, which it
      // refuses within a minute of the previous request.
      if (pending.current?.email === user.email) {
        openVerification({ ...pending.current, user, mode: formMode, newDevice, deviceCode }, { resetCooldown: false });
        return;
      }
      const { auth, nonce } = await requestEmailCode(user.email);
      openVerification({ auth, nonce, email: user.email, user, mode: formMode, newDevice, deviceCode });
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo preparar tu cuenta Cavos. Intentá nuevamente.'), 'error');
    } finally {
      if (!redirecting) setSubmitting(null);
    }
  };

  // "¿Olvidaste tu contraseña?": checks the new password, then sends a code to the email. The account's data in this
  // browser (name, company) is kept when it is the same email; the new password replaces the old one only after the key
  // was saved again with it (see finishAuthFlow).
  const handleResetSubmit = async (form: HTMLFormElement) => {
    const email = inputOf(form, 'email')?.value.trim() ?? '';
    // With Cavos' recovery on, the email is confirmed with a link (whose proof the enclave accepts) and the new password
    // is chosen after coming back: it is never kept while the email is on its way.
    if (anyDevice) {
      if (!EMAIL_PATTERN.test(email)) {
        showNotice('Escribí el correo de tu cuenta.', 'error');
        inputOf(form, 'email')?.focus();
        return;
      }
      setSubmitting('reset');
      try {
        const auth = await createCavosAuth(cavosAppId);
        await sendRecoveryLink(auth, email);
        writeStored(localStorage, PENDING_GOOGLE_KEY, { mode: 'reset', email, at: Date.now() });
        setLinkSent(email);
        cooldown.start();
        showNotice('');
      } catch (error) {
        showNotice(describeAuthError(error, 'No se pudo enviar el enlace. Intentá nuevamente.'), 'error');
      } finally {
        setSubmitting(null);
      }
      return;
    }
    const password = inputOf(form, 'password')?.value.trim() ?? '';
    const confirm = inputOf(form, 'passwordConfirm')?.value.trim() ?? '';
    if (!EMAIL_PATTERN.test(email)) {
      showNotice('Escribí el correo de tu cuenta.', 'error');
      inputOf(form, 'email')?.focus();
      return;
    }
    if (!PASSWORD_PATTERN.test(password)) {
      showNotice('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.', 'error');
      inputOf(form, 'password')?.focus();
      return;
    }
    if (confirm !== password) {
      showNotice('Las contraseñas no coinciden. Escribí la misma contraseña en los dos campos.', 'error');
      inputOf(form, 'passwordConfirm')?.focus();
      return;
    }
    setSubmitting('reset');
    try {
      const existing = storedUser();
      const sameAccount = existing?.email?.toLowerCase() === email.toLowerCase();
      const { password: _legacy, passwordHash: _previous, ...kept } = sameAccount && existing ? existing : { name: email.split('@')[0] ?? email, email };
      const user: StoredUser = { ...kept, email, passwordHash: await hashPassword(password) };
      const deviceCode = await deviceCodeFor(email, password);
      const { auth, nonce } = await requestEmailCode(email);
      openVerification({ auth, nonce, email, user, mode: 'reset', newDevice: false, deviceCode });
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo enviar el código. Intentá nuevamente.'), 'error');
    } finally {
      setSubmitting(null);
    }
  };

  // The login's password was changed on another device: an email code proves the account is theirs, and this browser
  // takes the new password (its key is saved again with it, which leaves it as the password of the account).
  const confirmNewPassword = async () => {
    const existing = storedUser();
    const password = changedPassword;
    if (!existing || !password) return;
    setChangedPassword(null);
    setSubmitting('login');
    try {
      const { password: _legacy, ...account } = existing;
      const user: StoredUser = { ...account, passwordHash: await hashPassword(password) };
      const deviceCode = await deviceCodeFor(user.email, password);
      const { auth, nonce } = await requestEmailCode(user.email);
      openVerification({ auth, nonce, email: user.email, user, mode: 'login', newDevice: false, deviceCode, changed: true });
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo enviar el código. Intentá nuevamente.'), 'error');
    } finally {
      setSubmitting(null);
    }
  };

  // Sends the recovery link again, from the screen that waits for it.
  const resendRecoveryLink = async () => {
    if (!linkSent || cooldown.isWaiting()) return;
    setResending(true);
    try {
      await sendRecoveryLink(await createCavosAuth(cavosAppId), linkSent);
      cooldown.start();
      showNotice('Te enviamos un enlace nuevo. Usá el del último correo.', 'success');
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo reenviar el enlace.'), 'error');
    } finally {
      setResending(false);
    }
  };

  const handleCodeSubmit = async (code: string, field: HTMLInputElement) => {
    if (codeInFlight.current) return;
    const current = pending.current;
    if (!current) {
      showNotice('La verificación expiró. Iniciá el proceso nuevamente.', 'error');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      showNotice('Ingresá el código de 6 dígitos que te enviamos por correo.', 'error');
      field.focus();
      return;
    }

    codeInFlight.current = true;
    setVerifyingCode(true);
    showNotice('Verificando el código y preparando tu cuenta...');
    try {
      const identity = await verifyEmailCode(current.auth, current.nonce, current.email, code);
      // On success the button stays disabled until the redirect.
      if (!(await finishAuthFlow(identity))) {
        codeInFlight.current = false;
        setVerifyingCode(false);
      }
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo verificar el código.'), 'error');
      field.select();
      codeInFlight.current = false;
      setVerifyingCode(false);
    }
  };

  const resendEmailCode = async () => {
    const current = pending.current;
    if (!current || cooldown.isWaiting()) return;
    setResending(true);
    showNotice('Enviando un nuevo código...');
    try {
      current.nonce = await sendEmailCode(current.auth, current.email);
      cooldown.start();
      showNotice('Enviamos un nuevo código. Usá el del último correo recibido.', 'success');
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo reenviar el código.'), 'error');
    } finally {
      setResending(false);
    }
  };

  const submitGooglePassword = async (form: HTMLFormElement) => {
    const current = pending.current;
    if (!current?.identity || !googlePassword) {
      setGooglePassword(null);
      showNotice('El acceso con Google expiró. Iniciá sesión nuevamente.', 'error');
      return;
    }
    const password = inputOf(form, 'password')?.value.trim() ?? '';
    const confirm = inputOf(form, 'passwordConfirm');
    // The current password, to open the key on this device and finish the reset (see finishAuthFlow).
    if (googlePassword.kind === 'current') {
      if (!password) {
        showNotice('Escribí tu contraseña actual.', 'error');
        return;
      }
      setGoogleSaving(true);
      showNotice('Abriendo la llave de tu wallet con tu contraseña actual...');
      try {
        pending.current = { ...current, currentCode: await deviceCodeFor(current.email, password) };
        if (await finishAuthFlow(current.identity)) setGooglePassword(null);
      } catch (error) {
        if (pending.current) {
          const { currentCode: _wrong, ...rest } = pending.current;
          pending.current = rest;
        }
        showNotice(describeAuthError(error, 'No se pudo abrir la llave de tu wallet. Intentá de nuevo.'), 'error');
      } finally {
        setGoogleSaving(false);
      }
      return;
    }
    if (!PASSWORD_PATTERN.test(password)) {
      showNotice('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.', 'error');
      return;
    }
    if (confirm && confirm.value.trim() !== password) {
      showNotice('Las contraseñas no coinciden. Escribí la misma contraseña en los dos campos.', 'error');
      return;
    }
    // A password this browser already knows for the account must be the same one: the key is saved with it. Not when
    // the point is to replace it.
    if (googlePassword.kind !== 'reset' && current.user.passwordHash && !(await verifyPassword(current.user, password))) {
      showNotice('Esa no es la contraseña de tu cuenta. Escribí la misma con la que la creaste.', 'error');
      return;
    }
    setGoogleSaving(true);
    showNotice('Guardando la llave de tu cuenta en Stellar...');
    try {
      const reset = googlePassword.kind === 'reset';
      pending.current = {
        ...current,
        deviceCode: await deviceCodeFor(current.user.email, password),
        // From now on the account also signs in with this password, without Google. A reset replaces the old one.
        user: { ...current.user, passwordHash: reset ? await hashPassword(password) : current.user.passwordHash ?? (await hashPassword(password)) }
      };
      const entered = await finishAuthFlow(current.identity);
      if (entered || reset) {
        setGooglePassword(null);
      } else {
        // A wrong password leaves the form open, with the reason in the notice. Its hash is not kept: the next try
        // would be checked against it and the right password refused.
        if (pending.current) pending.current = { ...pending.current, user: current.user };
        setMode('login');
      }
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo guardar la llave de tu cuenta. Intentá de nuevo.'), 'error');
    } finally {
      setGoogleSaving(false);
    }
  };

  // Returns to the form the user came from, keeping the code alive: Cavos only sends a new one once a minute.
  const leaveVerification = () => {
    setVerification(null);
    setMode(pending.current?.mode ?? 'login');
    showNotice(pending.current ? 'Tu código sigue siendo válido: tocá "Entrar a Verifire" para volver a ingresarlo.' : '');
  };

  const startGoogleLogin = async () => {
    if (!cavosAppId) {
      showNotice('Configurá CAVOS_APP_ID con el App ID real de Cavos para entrar con Google.', 'error');
      return;
    }
    setGoogleBusy(true);
    showNotice('Redirigiendo a Google...');
    try {
      const auth = await createCavosAuth(cavosAppId);
      const oauthUrl = await auth.getGoogleOAuthUrl(googleCallbackUrl());
      writeStored(localStorage, PENDING_GOOGLE_KEY, { mode: 'google', at: Date.now() });
      window.location.href = oauthUrl;
    } catch (error) {
      showNotice(describeAuthError(error, 'No se pudo iniciar sesión con Google.'), 'error');
      setGoogleBusy(false);
    }
  };

  useEffect(() => {
    // The <head> script already left for the panel (active session) before the form was drawn.
    if (document.documentElement.classList.contains('is-redirecting')) return;

    setSavedUsername(storedUser()?.name ?? '');
    if (cavosAppId) void socialRecoveryConfig(cavosAppId).then((config) => setAnyDevice(config.enabled));

    const params = new URLSearchParams(window.location.search);
    // "Crear cuenta" on the landing page opens the registration form.
    if (params.get('modo') === 'registro') setMode('register');
    // "Registrar mi empresa": kept through the email code and the Google redirect, so the company comes next.
    if (params.get('para') === 'empresa') rememberCompanyIntent();
    setForCompany(hasCompanyIntent());
    const reason = params.get('sesion');
    if (reason && reason in SESSION_NOTICES) {
      setNotice(SESSION_NOTICES[reason as SessionEndReason]);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (hasPendingClaim()) {
      // Set by the buyer's panel when a secret QR link was opened without a session.
      showNotice('Escaneaste el QR de un producto. Iniciá sesión para activar su garantía.');
    }

    const handleGoogleCallback = async () => {
      if (!params.has('cavos_auth_code')) return;
      const pendingGoogle = readStored<{ mode?: string; email?: string; at?: number }>(localStorage, PENDING_GOOGLE_KEY);
      localStorage.removeItem(PENDING_GOOGLE_KEY);
      window.history.replaceState({}, document.title, window.location.pathname);
      // What came back is decided by how the person signed in, not only by what this browser left before leaving: a mark
      // left by an older, abandoned attempt must not turn a recovery link into a Google login (or the other way).
      let auth: CavosAuth;
      let identity: Identity;
      try {
        auth = await createCavosAuth(cavosAppId);
        showNotice('Confirmando tu acceso...');
        identity = await auth.handleCallback(`?${params}`, googleCallbackUrl());
      } catch (error) {
        showNotice(describeAuthError(error, 'Este acceso de Cavos venció o ya fue usado. Pedí uno nuevo.'), 'error');
        return;
      }
      // The kit reads the provider from the token: Google's own, or the email link's (Firebase). When the token does not
      // say, the mark left before leaving decides, if it is recent: marks older than an hour belong to something the
      // person already abandoned.
      const provider = String(identity.provider ?? '');
      const viaGoogle = provider === 'google' || provider === 'google.com';
      const viaEmail = provider === 'email' || provider === 'emailLink' || provider === 'password';
      const fresh = typeof pendingGoogle?.at === 'number' && Date.now() - pendingGoogle.at < 60 * 60 * 1000;
      const marked = fresh ? pendingGoogle?.mode : undefined;
      const purpose = viaGoogle || (!viaEmail && marked === 'google') ? 'google' : marked === 'enroll' ? 'enroll' : 'reset';
      // Back from the link of the "Activá la recuperación" card: the key of this browser is sealed in the enclave.
      if (purpose === 'enroll') {
        try {
          showNotice('Activando la recuperación de tu cuenta...');
          const account = storedUser();
          if (account?.email && identity.email && account.email.toLowerCase() !== identity.email.toLowerCase()) {
            throw new Error('Ese enlace es de otro correo que la cuenta de este navegador.');
          }
          const { result } = await enableAnywhereRecovery(cavosAppId, auth, identity);
          if (result === 'enabled') {
            window.location.replace('/app?recuperacion=activada');
            return;
          }
          showNotice(result === 'other-device'
            ? 'Abrí el enlace en el navegador donde usás Verifire: es el que tiene la llave de tu wallet. Volvé a pedirlo desde "Mis garantías".'
            : 'No se pudo activar tu cuenta. Volvé a intentarlo desde "Mis garantías".', 'error');
        } catch (error) {
          showNotice(describeAuthError(error, 'El enlace venció o ya fue usado. Pedí uno nuevo desde "Mis garantías".'), 'error');
        }
        return;
      }
      // Back from the recovery link: the email is confirmed and the enclave's proof is fresh (it lasts five minutes). The
      // link may be opened in another browser or on another device than the one that asked for it, where nothing was
      // left behind: any return that is not a Google login is a recovery link.
      if (purpose === 'reset') {
        try {
          const email = identity.email ?? pendingGoogle?.email ?? '';
          if (!EMAIL_PATTERN.test(email)) throw new Error('El enlace no trajo un correo válido. Pedí uno nuevo.');
          const existing = storedUser();
          const same = existing?.email?.toLowerCase() === email.toLowerCase();
          const { password: _legacy, passwordHash: _previous, ...kept } = same && existing ? existing : { name: email.split('@')[0] ?? email, email };
          pending.current = { auth, email, user: { ...kept, email }, mode: 'reset', newDevice: false, identity };
          setGooglePassword({ kind: 'reset', email });
          showNotice('');
        } catch (error) {
          setMode('reset');
          showNotice(describeAuthError(error, 'El enlace venció o ya fue usado. Pedí uno nuevo.'), 'error');
        }
        return;
      }
      try {
        showNotice('Confirmando tu acceso con Google y preparando tu cuenta...');
        const user = googleUserFromIdentity(identity);
        pending.current = { auth, email: user.email, user, mode: 'login', newDevice: false, identity };
        // Without a password the account's key would stay in this browser only, and every other device would fail to
        // sign with it. It is saved (or opened) with the Verifire password before entering.
        const state = await keyBackupState(cavosAppId, auth, identity);
        if (state === 'create' || state === 'enter') {
          setGooglePassword({ kind: state === 'enter' || user.passwordHash ? 'enter' : 'create', email: user.email });
          showNotice('');
          return;
        }
        await finishAuthFlow(identity);
      } catch (error) {
        showNotice(describeAuthError(error, 'No se pudo confirmar el acceso con Google.'), 'error');
      }
    };
    void handleGoogleCallback();
    // Runs once, on the page load that may carry the Google callback.
  }, []);

  return (
    <>
      {!verification && !googlePassword && mode !== 'reset' && (
        <div className="auth-header">
          <div className="auth-tabs" role="tablist" aria-label="Acceso de usuario">
            {(['login', 'register'] as const).map((tabMode) => (
              <button
                key={tabMode}
                id={`${tabMode}-tab`}
                className={`auth-tab${mode === tabMode ? ' active' : ''}`}
                type="button"
                role="tab"
                aria-selected={mode === tabMode}
                aria-controls={`${tabMode}-panel`}
                onClick={() => {
                  setMode(tabMode);
                  setRegistered(null);
                  setChangedPassword(null);
                }}
              >
                {tabMode === 'login' ? 'Iniciar sesión' : 'Registrarse'}
              </button>
            ))}
          </div>
        </div>
      )}

      <LoginForm
        hidden={Boolean(verification || googlePassword) || mode !== 'login'}
        submitting={submitting === 'login'}
        googleBusy={googleBusy}
        onSubmit={(form) => void handleAuthSubmit('login', form)}
        onGoogleLogin={() => void startGoogleLogin()}
        prefill={loginPrefill}
        onForgotPassword={(identifier) => {
          setChangedPassword(null);
          setResetEmail(EMAIL_PATTERN.test(identifier) ? identifier : storedUser()?.email ?? '');
          setRegistered(null);
          showNotice('');
          setMode('reset');
        }}
      />
      {changedPassword && mode === 'login' && !verification && !googlePassword && (
        <div className="auth-existing auth-changed" role="status">
          <p>¿Cambiaste tu contraseña desde otro navegador o dispositivo? Este navegador todavía tiene guardada la anterior.</p>
          <div className="auth-existing-actions">
            <button type="button" className="button button-secondary" disabled={submitting === 'login'} onClick={() => void confirmNewPassword()}>
              Usar esta contraseña y confirmar con un código
            </button>
          </div>
        </div>
      )}

      {linkSent && mode === 'reset' && !verification && !googlePassword && (
        <div className="email-verification-form" role="status">
          <div className="verification-badge"><i className="fa-solid fa-envelope-open-text" aria-hidden="true" /></div>
          <h2>Entrá al enlace para continuar</h2>
          <p>
            Te enviamos un enlace a <strong>{linkSent}</strong>. Para cambiar tu contraseña tenés que entrar a ese enlace: podés abrirlo en
            este navegador o en otro dispositivo, y ahí vas a elegir la contraseña nueva.
          </p>
          <p>Cuando la cambies, volvé acá e iniciá sesión con tu contraseña nueva.</p>
          <div className="magic-link-status">
            <i className="fa-regular fa-clock" aria-hidden="true" />
            <span>Si no llega en unos minutos, revisá la carpeta de spam.</span>
          </div>
          <button type="button" className="button button-secondary" disabled={resending || cooldown.waiting} onClick={() => void resendRecoveryLink()}>
            {cooldown.labelFor('enlace')}
          </button>
          <button type="button" className="button button-secondary" onClick={() => setLinkSent(null)}>Usar otro correo</button>
          <button
            type="button"
            className="verification-back-button"
            onClick={() => {
              setLinkSent(null);
              showNotice('');
              setMode('login');
            }}
          >
            Volver a iniciar sesión
          </button>
        </div>
      )}

      <ResetPasswordForm
        hidden={Boolean(verification || googlePassword || linkSent) || mode !== 'reset'}
        submitting={submitting === 'reset'}
        email={resetEmail}
        anyDevice={anyDevice}
        onSubmit={(form) => void handleResetSubmit(form)}
        onBack={() => {
          showNotice('');
          setMode('login');
        }}
      />
      <RegisterForm
        hidden={Boolean(verification || googlePassword) || mode !== 'register'}
        submitting={submitting === 'register'}
        savedUsername={savedUsername}
        forCompany={forCompany}
        onSubmit={(form) => void handleAuthSubmit('register', form)}
      />

      {registered && mode === 'register' && !verification && !googlePassword && (
        <div className="auth-existing" role="alert">
          <strong>
            <i className="fa-solid fa-circle-user" aria-hidden="true" /> Este correo ya tiene una cuenta
          </strong>
          <p>
            <b>{registered}</b> ya está registrado en Verifire. Iniciá sesión con ese correo y tu contraseña: si es la primera
            vez que entrás desde este navegador, te enviamos un código para recuperar tu cuenta, tus garantías y tu wallet.
          </p>
          <div className="auth-existing-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setLoginPrefill(registered);
                setRegistered(null);
                setMode('login');
              }}
            >
              Iniciar sesión con este correo
            </button>
            <button type="button" className="button button-secondary" onClick={() => setRegistered(null)}>
              Usar otro correo
            </button>
          </div>
        </div>
      )}

      {googlePassword && (
        <GooglePasswordForm
          kind={googlePassword.kind}
          email={googlePassword.email}
          submitting={googleSaving}
          onSubmit={(form) => void submitGooglePassword(form)}
          onCancel={() => {
            pending.current = null;
            setGooglePassword(null);
            showNotice('');
          }}
        />
      )}

      {verification && (
        <EmailCodeForm
          kind={verification.kind}
          email={verification.email}
          verifying={verifyingCode}
          resendLabel={cooldown.label}
          resendDisabled={resending || cooldown.waiting}
          onSubmit={(code, field) => void handleCodeSubmit(code, field)}
          onResend={() => void resendEmailCode()}
          onBack={leaveVerification}
        />
      )}

      <p className={notice.text ? `auth-message ${notice.tone}` : 'auth-message'} aria-live="polite">{notice.text}</p>
    </>
  );
}
