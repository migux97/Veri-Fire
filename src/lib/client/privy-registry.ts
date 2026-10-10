// The Privy wallet, shared by every island of the page. Privy's hooks only work inside its provider, which PrivyBridge
// mounts once per page (see BaseLayout); it registers here what the rest of the client calls, outside React.
export interface PrivyLogin {
  email: string;
  name: string;
  address: string;
}

export interface PrivyBridgeApi {
  // The address of the Solana wallet Privy holds for the user logged in, if any.
  address: () => string | null;
  // Opens Privy's login (email code or Google) and settles once the user has a Solana wallet.
  login: () => Promise<PrivyLogin>;
  logout: () => Promise<void>;
  // Wire transaction in, the same transaction with the user's signature out.
  signTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

const BRIDGE_TIMEOUT_MS = 15_000;

let bridge: PrivyBridgeApi | null = null;
const waiting: ((api: PrivyBridgeApi) => void)[] = [];

export const registerPrivyBridge = (api: PrivyBridgeApi | null) => {
  bridge = api;
  if (api) for (const resolve of waiting.splice(0)) resolve(api);
};

// The bridge if Privy already loaded on this page, without waiting for it.
export const currentPrivyBridge = () => bridge;

// Privy says it is ready before the user's wallet has loaded, so a page that signs as soon as it opens (the company
// panel syncs on load) would find no wallet and take it for a different one. This waits for the wallet a few seconds;
// null after that means Privy really has no session in this browser.
const WALLET_WAIT_MS = 10_000;
const WALLET_POLL_MS = 150;

export const privyWalletAddress = async (): Promise<string | null> => {
  await privyBridge();
  const deadline = Date.now() + WALLET_WAIT_MS;
  // The bridge is registered again when Privy's hooks change, so it is read fresh on every look.
  let address = bridge?.address() ?? null;
  while (!address && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, WALLET_POLL_MS));
    address = bridge?.address() ?? null;
  }
  return address;
};

// The bridge once Privy loaded. It fails when the page has no bridge (PRIVY_APP_ID missing) or Privy never answered.
export const privyBridge = (): Promise<PrivyBridgeApi> => {
  if (bridge) return Promise.resolve(bridge);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const index = waiting.indexOf(done);
      if (index >= 0) waiting.splice(index, 1);
      reject(new Error('No se pudo cargar Privy. Revisá tu conexión y recargá la página.'));
    }, BRIDGE_TIMEOUT_MS);
    const done = (api: PrivyBridgeApi) => {
      window.clearTimeout(timer);
      resolve(api);
    };
    waiting.push(done);
  });
};
