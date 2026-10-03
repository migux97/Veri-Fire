// The buyer's Stellar wallet, held by Cavos. Its signing key lives in this browser (IndexedDB) and under this site
// address: localhost and the public URL are two different places for it, even on the same computer.
import type { CavosAuth, CavosStellar, Identity } from '@cavos/kit';
import { errorMessage } from '../errors';
import { isStellarAddress } from '../validation';
import { storedUser, updateStoredUser } from './account';
import { isWalletAddress, onSolana } from './chain';
import { privyBridge } from './privy-registry';
import { DEVICE_CODE_KEY, userSession, WALLET_KEY, WALLET_UPDATED_EVENT } from './session';
import { chooseIdentity } from './identity-choice';
import { enrollSocialRecovery, recoverWithSocial } from './social-recovery';
import { readStored, writeStored } from './storage';

const APP_SALT = 'verifire-demo';
// The multi-device factor is an encrypted wrap stored in the account itself (a cv:wr entry).
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

// Thrown when signing needs the email confirmed again with a code: the panel sends the user to log in.
export class EmailCodeRequiredError extends Error {
  constructor() {
    super('Para firmar en Stellar necesitamos confirmar tu correo con un código.');
    this.name = 'EmailCodeRequiredError';
  }
}

// Thrown when this browser cannot sign yet. `canRetry`: the account's password can enable it here (see enableSigning);
// otherwise only the browser that created the wallet holds its key.
export class DeviceNotReadyError extends Error {
  readonly canRetry: boolean;

  constructor(message: string, canRetry: boolean) {
    super(message);
    this.canRetry = canRetry;
    this.name = 'DeviceNotReadyError';
  }
}

const ORIGINAL_BROWSER_ONLY = 'Tu cuenta todavía no guardó su llave en Stellar, y solo la tiene el navegador donde la creaste. Abrí Verifire ahí (si fue en tu computadora, http://localhost:5501), entrá una vez y volvé a probar acá.';
const WRONG_PASSWORD = 'Esa no es la contraseña de tu cuenta. Escribí la misma con la que la creaste.';

export const loadCavosKit = () => import('./cavos-kit');

export const createCavosAuth = async (appId: string) => {
  const { CavosAuth } = await loadCavosKit();
  return new CavosAuth(appId ? { appId } : {});
};

export const rememberWallet = (address: string | undefined) => {
  if (isWalletAddress(address)) {
    writeStored(localStorage, WALLET_KEY, { address, connectedAt: new Date().toISOString() });
    window.dispatchEvent(new Event(WALLET_UPDATED_EVENT));
  }
};

export const rememberDeviceCode = (deviceCode: string | undefined) => {
  try {
    if (deviceCode) sessionStorage.setItem(DEVICE_CODE_KEY, deviceCode);
  } catch {
    // Without storage the account is enabled at the next login instead.
  }
};

export const storedDeviceCode = () => {
  try {
    return sessionStorage.getItem(DEVICE_CODE_KEY) ?? '';
  } catch {
    return '';
  }
};

// Connects the Stellar wallet of an identity Cavos authenticated (email code or Google): its token lets the Cavos
// registry verify who owns the address.
type CavosRegistry = NonNullable<Parameters<typeof import('@cavos/kit').Cavos.connect>[0]['registry']>;

// The Cavos registry maps the account to its wallet, and asking it needs the Cavos login token, which expires within
// hours while a password-only login lasts days. The address is already known (saved when the email was verified), so
// without a token it is answered from here instead of failing with "registry lookup skipped: no login token".
const knownWalletRegistry = (address: string): CavosRegistry => ({
  lookup: async () => ({ address }),
  register: async (params) => ({ address, conflict: params.address !== address })
});

const openCavosWallet = async (appId: string, auth: CavosAuth, identity: Identity, knownAddress?: string): Promise<CavosStellar> => {
  const { Cavos } = await loadCavosKit();
  const registry = knownAddress && !auth.getAuthToken() ? knownWalletRegistry(knownAddress) : undefined;
  const session = await Cavos.connect({
    ...(registry ? { registry } : {}),
    chains: ['stellar'],
    defaultChain: 'stellar',
    network: 'testnet',
    appSalt: APP_SALT,
    ...(appId ? { appId } : {}),
    identity,
    auth
  });
  const wallet = session.wallet('stellar');
  if (wallet.chain !== 'stellar' || !isStellarAddress(wallet.address)) {
    throw new Error('Cavos no devolvió una dirección Stellar para esta cuenta. Revisá el App ID de Cavos.');
  }
  return wallet;
};

// Whether the account saved its multi-device factor. Null when Horizon cannot tell. Read apart because the kit reports
// an account that never saved one and a password that cannot open it the same way.
export const hasDeviceFactor = async (address: string): Promise<boolean | null> => {
  try {
    const response = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(address)}`);
    // Not on Stellar yet: nothing was saved, and only the browser that created the wallet holds its key.
    if (response.status === 404) return false;
    if (!response.ok) return null;
    const account = (await response.json()) as { data?: Record<string, string> };
    return Object.keys(account.data ?? {}).some((key) => key.startsWith('cv:wr'));
  } catch {
    return null;
  }
};

// Cavos seals the signing key inside the account and each browser keeps its own copy of what opens it. The device
// factor derived from the password enrolls the first browser and unlocks every other device the user logs into, so a
// phone needs nothing beyond signing in.
// Enables this browser to sign, or explains why it could not. It never throws: the caller has already verified the
// user, and a login must not fail over this.
const authorizeDevice = async (wallet: CavosStellar, deviceCode: string): Promise<{ ok: boolean; error: string; wrongPassword?: boolean }> => {
  if (wallet.status === 'needs-device-approval') {
    if (await hasDeviceFactor(wallet.address) === false) {
      return { ok: false, error: 'Tu cuenta todavía no tiene habilitado el uso en varios dispositivos. Abrí Verifire en la misma dirección donde la creaste (si fue en tu computadora, http://localhost:5501) y entrá una vez con tu correo y contraseña: se habilita solo.' };
    }
    try {
      await wallet.approveThisDeviceWithRecovery(deviceCode);
      return { ok: true, error: '' };
    } catch (error) {
      const message = errorMessage(error);
      const wrongPassword = /wrong factor|not enrolled/i.test(message);
      return { ok: false, wrongPassword, error: wrongPassword ? WRONG_PASSWORD : message };
    }
  }
  // Saves the factor of an account created before this existed; a new account saves it with its first login.
  try {
    await wallet.setupRecovery(deviceCode);
    // A new wallet exists only in this browser, and the kit keeps the factor in memory until the account is created on
    // Stellar: it is created now, with the factor, so another device or site address can open it from the first day.
    if (wallet.status === 'undeployed') await createAccountOnChain(wallet);
    return { ok: true, error: '' };
  } catch (error) {
    return { ok: false, error: `No se pudo guardar el uso en varios dispositivos: ${errorMessage(error)}` };
  }
};

// Cavos creates the account with the first transaction it sends: a 1-stroop payment to itself, sponsored by Cavos. The
// payment can fail because the new account holds no XLM, which does not matter once the account exists.
export const createAccountOnChain = async (wallet: CavosStellar) => {
  try {
    await wallet.execute(1n, wallet.address);
  } catch (error) {
    // execute() moves the status to "ready" as soon as the account exists, even when the payment itself failed.
    if ((wallet.status as string) !== 'ready') throw new Error(`No se pudo crear tu cuenta en Stellar: ${errorMessage(error)}`);
  }
};

// Whether signing in without a password (Google) leaves the account usable on other devices. Its key is saved in
// Stellar with a password: without one it would live only in this browser, at this exact site address.
//  - 'ready': this browser signs and the key is saved; nothing to ask.
//  - 'create': this browser holds the key but never saved it; a password saves it now.
//  - 'enter': another device saved it; the password enables this one.
//  - 'lost': only the browser that created the account holds its key, and it never saved it.
export type KeyBackupState = 'ready' | 'create' | 'enter' | 'lost';

export const keyBackupState = async (appId: string, auth: CavosAuth, identity: Identity): Promise<KeyBackupState> => {
  const wallet = await openCavosWallet(appId, auth, identity);
  const factor = await hasDeviceFactor(wallet.address);
  if (wallet.status === 'needs-device-approval') return factor === false ? 'lost' : 'enter';
  // Stellar did not answer: asking for a new password could replace the one the other devices use. It is saved later
  // by saveKeyIfMissing when it turns out to be missing.
  if (factor === null && wallet.status === 'ready') return 'ready';
  return factor === true && wallet.status === 'ready' ? 'ready' : 'create';
};

// A new password for the account: the copy of its key kept in Stellar is saved again with it, so the old password stops
// opening it. Only a browser that already holds the key can do that (ok: false otherwise): the copy in Stellar is sealed
// with the old password, which Verifire never knew. Devices already enabled keep working.
// Thrown when the current password given to open the key on this device is not the account's.
export const WRONG_CURRENT_PASSWORD = 'Esa no es tu contraseña actual. Escribí la que usás hoy para entrar a Verifire.';

// currentCode: the device code of the current password, when the user gave it to open the key on this device.
export const resetKeyPassword = async (appId: string, auth: CavosAuth, identity: Identity, deviceCode: string, currentCode?: string) => {
  const wallet = await openCavosWallet(appId, auth, identity);
  // A device that does not hold the key opens it through Cavos' recovery enclave, when the account was sealed there,
  // or with the current password, which also opens the copy kept in Stellar.
  if (wallet.status === 'needs-device-approval') {
    if (currentCode) {
      try {
        await wallet.approveThisDeviceWithRecovery(currentCode);
      } catch (error) {
        const message = errorMessage(error);
        throw new Error(/wrong factor|not enrolled/i.test(message) ? WRONG_CURRENT_PASSWORD : message);
      }
    } else if (!(await recoverWithSocial(appId, auth, wallet))) {
      // needsCurrent: a copy sealed with the password exists in Stellar, so the current password can open it.
      return { address: wallet.address, ok: false as const, needsCurrent: (await hasDeviceFactor(wallet.address)) !== false };
    }
  }
  await wallet.setupRecovery(deviceCode);
  await enrollSocialRecovery(appId, auth, wallet);
  if (wallet.status === 'undeployed') await createAccountOnChain(wallet);
  rememberWallet(wallet.address);
  rememberDeviceCode(deviceCode);
  return { address: wallet.address, ok: true as const, needsCurrent: false };
};

// Seals the account's key in Cavos' recovery enclave, from the link of the "Activá la recuperación" card. Only a browser
// that holds the key can do it.
export const enableAnywhereRecovery = async (appId: string, auth: CavosAuth, identity: Identity) => {
  const wallet = await openCavosWallet(appId, auth, identity);
  if (wallet.status === 'needs-device-approval') return { address: wallet.address, result: 'other-device' as const };
  return { address: wallet.address, result: (await enrollSocialRecovery(appId, auth, wallet)) ? 'enabled' as const : 'failed' as const };
};

export const connectCavosWallet = async (appId: string, auth: CavosAuth, identity: Identity, deviceCode?: string) => {
  const wallet = await openCavosWallet(appId, auth, identity);
  rememberWallet(wallet.address);
  rememberDeviceCode(deviceCode);
  const device = deviceCode ? await authorizeDevice(wallet, deviceCode) : { ok: false, error: '' };
  // A device that holds the key right after a fresh login seals it in Cavos' recovery enclave (once), so the account
  // can be recovered from any other device later. Nothing happens while the app has not turned it on.
  if (device.ok || wallet.status === 'ready') await enrollSocialRecovery(appId, auth, wallet);
  // The password opens the account's key on every device: one that does not is a wrong password, not a device issue.
  return { address: wallet.address, deviceFactor: device.ok, deviceError: device.error, wrongPassword: Boolean(device.wrongPassword) };
};

// The account's wallet, whatever this browser can do with it. A password-only login has no Cavos session, but the Cavos
// user id saved when the email was verified reconnects the same wallet, whose keys stay in this browser's IndexedDB.
const openOwnWallet = async (appId: string, expectedAddress: string) => {
  const account = storedUser();
  const auth = await createCavosAuth(appId);
  const { identity, foreign } = chooseIdentity(auth.restoreIdentity(), account, userSession.email());
  // The Cavos login left in this browser is another account's: it is dropped, with its token, so it cannot sign for this
  // one and the account's own login (its saved user id) reopens its wallet instead.
  if (foreign) auth.clearStoredIdentity();
  if (!identity) throw new EmailCodeRequiredError();

  let wallet;
  try {
    wallet = await openCavosWallet(appId, auth, identity, expectedAddress);
  } catch (error) {
    // Cavos wants the login confirmed again: the panel asks for an email code instead of showing Cavos' message.
    if (/no login token|unauthori[sz]ed|401/i.test(errorMessage(error))) throw new EmailCodeRequiredError();
    throw error;
  }
  if (wallet.address !== expectedAddress) {
    throw new Error('La wallet Cavos de este navegador no coincide con la de tu cuenta. Cerrá sesión y volvé a entrar con tu correo: te enviamos un código y se corrige.');
  }
  return wallet;
};

// A wallet able to sign on Stellar.
export const connectSigningWallet = async (appId: string, expectedAddress: string) => {
  const wallet = await openOwnWallet(appId, expectedAddress);
  // This browser is enabled while signing in (see authorizeDevice). Reaching here means that did not happen, which is
  // not a missing email code: the session stays open and the message says what to do.
  if (wallet.status === 'needs-device-approval') {
    const deviceCode = storedDeviceCode();
    const factor = await hasDeviceFactor(wallet.address);
    if (deviceCode && factor) {
      // The password of this login opens the account's factor: this browser is enabled here instead of at login.
      try {
        await wallet.approveThisDeviceWithRecovery(deviceCode);
        return wallet;
      } catch {
        // Falls through to the explanation below.
      }
    }
    throw factor === false
      ? new DeviceNotReadyError(ORIGINAL_BROWSER_ONLY, false)
      : new DeviceNotReadyError('Este navegador todavía no está habilitado para firmar con tu cuenta. Tocá "Reintentar" para habilitarlo.', true);
  }
  await saveKeyIfMissing(wallet);
  return wallet;
};

// Checked once per page at a time: the panel's sync and a signature can ask together, and both would send the
// transactions that save the key. Settled only once Stellar confirmed the key is there (or it was just saved).
let keySaving: Promise<boolean> | null = null;
let keySaved = false;

// This browser holds the account's key: when Stellar still has no copy (the account was created before the multi-device
// factor, or saving it failed at sign-up), it is saved now with the password of this login. Without it every other
// device fails with ORIGINAL_BROWSER_ONLY, and this browser is the only place that can fix that. It never throws:
// signing works here either way.
const saveKeyIfMissing = async (wallet: CavosStellar) => {
  if (keySaved) return;
  const deviceCode = storedDeviceCode();
  if (!deviceCode) return;
  keySaving ??= (async () => {
    try {
      const undeployed = wallet.status === 'undeployed';
      const factor = undeployed ? false : await hasDeviceFactor(wallet.address);
      // Stellar did not answer: tried again at the next signature.
      if (factor === null) return false;
      if (factor === false) {
        await wallet.setupRecovery(deviceCode);
        if (undeployed) await createAccountOnChain(wallet);
        updateStoredUser({ deviceFactorAt: Date.now() });
      }
      return true;
    } catch (error) {
      console.warn('No se pudo guardar la llave de la cuenta en Stellar:', errorMessage(error));
      return false;
    }
  })().finally(() => {
    keySaving = null;
  });
  keySaved = await keySaving;
};

// Everything that lets this browser sign, from the account's password: enables it with the key saved in Stellar,
// creates the account on Stellar when it is not there yet, and saves that key when the account never did.
export const enableSigning = async (appId: string, expectedAddress: string, deviceCode: string) => {
  rememberDeviceCode(deviceCode);
  const wallet = await openOwnWallet(appId, expectedAddress);
  if (wallet.status === 'needs-device-approval') {
    if (await hasDeviceFactor(wallet.address) === false) throw new DeviceNotReadyError(ORIGINAL_BROWSER_ONLY, false);
    try {
      await wallet.approveThisDeviceWithRecovery(deviceCode);
    } catch (error) {
      const message = errorMessage(error);
      throw new Error(/wrong factor|not enrolled/i.test(message) ? WRONG_PASSWORD : message);
    }
  } else if (wallet.status === 'undeployed') {
    await wallet.setupRecovery(deviceCode);
    await createAccountOnChain(wallet);
  } else if (await hasDeviceFactor(wallet.address) === false) {
    await wallet.setupRecovery(deviceCode);
  }
  updateStoredUser({ deviceFactorAt: Date.now() });
};

export const resolveWalletAddress = async (appId: string) => {
  const cached = readStored<{ address?: unknown }>(localStorage, WALLET_KEY);
  if (isWalletAddress(cached?.address)) return cached.address;
  // The account keeps the wallet linked when its email was verified, so a new session does not reconnect to Cavos.
  const account = storedUser();
  if (isWalletAddress(account?.walletAddress) && account.email === userSession.email()) {
    rememberWallet(account.walletAddress);
    return account.walletAddress;
  }
  // On Solana the wallet is the one of the Privy session in this browser.
  if (onSolana()) {
    const address = (await privyBridge()).address();
    if (!address) throw new Error('No encontramos tu wallet en este navegador. Cerrá sesión y volvé a entrar.');
    rememberWallet(address);
    return address;
  }
  const auth = await createCavosAuth(appId);
  const identity = auth.restoreIdentity();
  if (!identity) throw new Error('No encontramos tu cuenta Cavos en este navegador. Cerrá sesión y volvé a entrar.');
  return (await connectCavosWallet(appId, auth, identity)).address;
};
