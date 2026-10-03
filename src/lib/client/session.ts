// The account stays in this browser; the session in front of it lasts 8 hours from login.
// Imported by page frontmatter for its constants, so nothing here touches the browser at module load.
import { readRaw, readStored, removeStored, storedKeys, writeRaw, writeStored } from './storage';
import { currentPrivyBridge } from './privy-registry';

export const SESSION_KEY = 'verifireAuthSession';
export const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const SESSION_CHECK_MS = 60 * 1000;
export const WALLET_KEY = 'verifireWallet';
export const WALLET_UPDATED_EVENT = 'verifire:wallet-updated';
// The key derived from the password that opens the signing key on any device. It lives in sessionStorage so the
// panel can finish enabling an account whose login could not, and it dies with the tab.
export const DEVICE_CODE_KEY = 'verifireDeviceCode';
// Set in this tab once it opens a page behind login: from then on the landing page sends it back to the panel. A new
// tab starts without it, so it shows the landing page with the profile and a link to the panel.
export const IN_APP_KEY = 'verifireInApp';
// Everything a panel keeps for the account signed in here (agenda, templates, team, transfer links) goes under this
// prefix plus the account's email, so two accounts in the same browser never read each other's data.
const ACCOUNT_PREFIX = 'verifire:account';

// Shown by the login page after leaving a session (see sessionNotices in the auth panel).
export type SessionEndReason = 'expirada' | 'cerrada' | 'verificar';

interface StoredSession {
  email: string;
  startedAt: number;
}

export const userSession = {
  read: () => readStored<StoredSession>(localStorage, SESSION_KEY),
  isActive: () => {
    const session = userSession.read();
    return Boolean(session) && Date.now() - Number(session?.startedAt) < SESSION_MAX_MS;
  },
  email: () => userSession.read()?.email ?? '',
  start: (email: string) => writeStored(localStorage, SESSION_KEY, { email, startedAt: Date.now() }),
  // Removes everything that lets this browser act as the user, but keeps the account and the Cavos device keys
  // (IndexedDB), so logging in again recovers the same wallet.
  end: () => {
    removeStored(localStorage, SESSION_KEY);
    removeStored(localStorage, WALLET_KEY);
    removeStored(sessionStorage, DEVICE_CODE_KEY);
    removeStored(sessionStorage, IN_APP_KEY);
    removeStored(sessionStorage, 'verifireSession');
    removeStored(sessionStorage, WALLET_KEY);
    // The account's own data stays (it is keyed by email), so logging in again finds it. The secrets of open transfer
    // links do not: whoever used this browser next could open one and take the product. The owner can still cancel a
    // link from the panel and open a new one.
    for (const storage of [localStorage, sessionStorage]) {
      storedKeys(storage)
        .filter(
          (key) =>
            key.startsWith('cavos-kit:identity:') ||
            key.startsWith('cavos-kit:token:') ||
            key.startsWith(`${ACCOUNT_PREFIX}:transfer-links:`) ||
            key === 'verifireTransferLinks'
        )
        .forEach((key) => removeStored(storage, key));
    }
  }
};

// The panel had a demo mode that kept sample data under keys ending in ":demo", switched on by a flag. It was removed:
// whatever it left in this browser for the account is deleted the first time the account's data is read.
let demoLeftoversChecked = '';
const removeDemoLeftovers = () => {
  const email = userSession.email().toLowerCase();
  if (!email || demoLeftoversChecked === email) return;
  demoLeftoversChecked = email;
  removeStored(localStorage, `verifire:demo-mode:${email}`);
  for (const key of storedKeys(localStorage)) {
    if (key.startsWith(`${ACCOUNT_PREFIX}:`) && key.endsWith(`:${email}:demo`)) removeStored(localStorage, key);
  }
};

// Key of one kind of data for the account signed in now. Data saved before this existed is carried over once.
export const accountKey = (name: string, legacyKey?: string) => {
  removeDemoLeftovers();
  const key = `${ACCOUNT_PREFIX}:${name}:${userSession.email().toLowerCase()}`;
  const legacy = legacyKey ? readRaw(localStorage, legacyKey) : null;
  if (legacy !== null && readRaw(localStorage, key) === null) {
    writeRaw(localStorage, key, legacy);
    removeStored(localStorage, legacyKey as string);
  }
  return key;
};

export const leaveSession = (reason: SessionEndReason) => {
  userSession.end();
  const leave = () => window.location.replace(`/login?sesion=${reason}`);
  // On Solana the wallet lives in Privy's own session: closing Verifire's closes it too, so the next person to use this
  // browser does not get it. Leaves anyway if Privy does not answer.
  const privy = currentPrivyBridge();
  if (reason === 'cerrada' && privy) {
    void Promise.race([privy.logout(), new Promise((resolve) => window.setTimeout(resolve, 3000))]).finally(leave);
    return;
  }
  leave();
};

// For pages behind login. Without an active session it clears any stale one and sends the user to the login page.
// With one, it ends the session here as soon as it expires or is closed in another tab.
export const guardSession = () => {
  if (!userSession.isActive()) {
    const hadSession = Boolean(userSession.read());
    if (hadSession) userSession.end();
    window.location.replace(hadSession ? '/login?sesion=expirada' : '/login');
    return;
  }
  try {
    sessionStorage.setItem(IN_APP_KEY, '1');
  } catch {
    // Without storage the landing page stays reachable from the panel.
  }

  // Activity does not extend the session: it always ends 8 hours after login.
  const check = () => {
    if (!userSession.isActive()) leaveSession('expirada');
  };
  window.setInterval(check, SESSION_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  const startedAs = userSession.email();
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY) return;
    if (!event.newValue) leaveSession('cerrada');
    // Another tab signed in with a different account: this page would keep acting as the previous one.
    else if (userSession.email() !== startedAs) window.location.reload();
  });
};
