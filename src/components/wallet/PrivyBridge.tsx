// Mounts Privy once per page when the server runs on Solana (CHAIN=solana) and registers its wallet in privy-registry,
// so login, transactions and wallet proofs reach it from any island. It draws nothing besides Privy's own modals.
// Keep this import first: Privy's Solana signing needs `Buffer` in the browser.
import '@/lib/client/node-globals';
import { PrivyProvider, useLogin, useLogout, usePrivy, type User } from '@privy-io/react-auth';
import { useCreateWallet, useSignMessage, useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';
import { registerPrivyBridge, type PrivyLogin } from '@/lib/client/privy-registry';

interface PrivyBridgeProps {
  appId: string;
  cluster: string;
}

type SolanaChain = 'solana:mainnet' | 'solana:devnet' | 'solana:testnet';

const chainOf = (cluster: string): SolanaChain => (cluster === 'mainnet-beta' ? 'solana:mainnet' : cluster === 'testnet' ? 'solana:testnet' : 'solana:devnet');

// Privy signs transactions only for chains it has an RPC for ("No RPC configuration found for chain solana:devnet").
// The public endpoint of the cluster the server uses is enough: the server builds, pays and sends every transaction.
const PUBLIC_RPC: Record<SolanaChain, string> = {
  'solana:mainnet': 'api.mainnet-beta.solana.com',
  'solana:devnet': 'api.devnet.solana.com',
  'solana:testnet': 'api.testnet.solana.com'
};

const rpcsFor = (cluster: string) => {
  const chain = chainOf(cluster);
  const host = PUBLIC_RPC[chain];
  return {
    [chain]: {
      rpc: createSolanaRpc(`https://${host}`),
      rpcSubscriptions: createSolanaRpcSubscriptions(`wss://${host}`),
      blockExplorerUrl: 'https://explorer.solana.com'
    }
  };
};

const profileOf = (user: User) => ({
  email: user.email?.address ?? user.google?.email ?? '',
  name: user.google?.name ?? ''
});

interface PendingLogin {
  resolve: (login: PrivyLogin) => void;
  reject: (error: Error) => void;
  profile: { email: string; name: string } | null;
  creating?: boolean;
  timer?: number;
}

// Once the user is in, the wallet has this long to show up before the login gives up with a clear message.
const WALLET_TIMEOUT_MS = 20_000;
const NO_WALLET = 'Privy no creó tu wallet de Solana. Activá las wallets de Solana en el panel de Privy (Embedded wallets) y volvé a intentar.';

function Bridge({ cluster }: { cluster: string }) {
  const { ready, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const pendingLogin = useRef<PendingLogin | null>(null);
  // Bumped when a login starts waiting for its wallet, so the effect below looks again even if nothing else changed.
  const [waitingSince, setWaitingSince] = useState(0);
  // Logins are by email or Google only, so the one Solana wallet is the embedded one Privy created for the user.
  const wallet = authenticated ? wallets[0] ?? null : null;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const userRef = useRef(user);
  userRef.current = user;

  const settle = (outcome: { address: string } | Error) => {
    const pending = pendingLogin.current;
    if (!pending) return;
    pendingLogin.current = null;
    window.clearTimeout(pending.timer);
    if (outcome instanceof Error) pending.reject(outcome);
    else if (pending.profile) pending.resolve({ ...pending.profile, address: outcome.address });
  };

  // The user is in: from here the wallet has WALLET_TIMEOUT_MS to arrive, so the button never spins forever.
  const awaitWallet = (pending: PendingLogin, profile: { email: string; name: string }) => {
    pending.profile = profile;
    window.clearTimeout(pending.timer);
    pending.timer = window.setTimeout(() => settle(new Error(NO_WALLET)), WALLET_TIMEOUT_MS);
    setWaitingSince(Date.now());
  };

  const { login } = useLogin({
    onComplete: ({ user: loggedIn }) => {
      if (pendingLogin.current) awaitWallet(pendingLogin.current, profileOf(loggedIn));
    },
    onError: (error) => {
      settle(new Error(error === 'exited_auth_flow' ? 'Cerraste el acceso antes de terminar.' : 'No se pudo iniciar sesión con Privy.'));
    }
  });

  // The login settles once Privy created (or found) the user's Solana wallet, which arrives after onComplete. When the
  // app's settings did not create it on login, it is created here once.
  useEffect(() => {
    const pending = pendingLogin.current;
    if (!pending?.profile || !walletsReady) return;
    if (wallet) {
      settle({ address: wallet.address });
      return;
    }
    if (!authenticated || pending.creating) return;
    pending.creating = true;
    createWallet()
      .then(({ wallet: created }) => settle({ address: created.address }))
      .catch((error: unknown) => settle(new Error(`${NO_WALLET} (${error instanceof Error ? error.message : String(error)})`)));
  }, [wallet, walletsReady, authenticated, user, createWallet, waitingSince]);

  useEffect(() => {
    if (!ready) return;
    const current = () => {
      const signer = walletRef.current;
      if (!signer) throw new Error('Tu sesión de Privy se cerró. Cerrá sesión en Verifire y volvé a entrar.');
      return signer;
    };
    registerPrivyBridge({
      address: () => walletRef.current?.address ?? null,
      login: () =>
        new Promise<PrivyLogin>((resolve, reject) => {
          // Already logged in to Privy in this browser: the same user and wallet, without opening the modal.
          const signer = walletRef.current;
          if (userRef.current && signer) {
            resolve({ ...profileOf(userRef.current), address: signer.address });
            return;
          }
          settle(new Error('Se abrió otro acceso.'));
          // Logged in but its wallet not loaded yet: the effect above settles it when it arrives (or creates it).
          const known = userRef.current;
          const pending: PendingLogin = { resolve, reject, profile: null };
          pendingLogin.current = pending;
          if (known) awaitWallet(pending, profileOf(known));
          else login();
        }),
      logout: () => logout(),
      signTransaction: async (transaction) =>
        (await signTransaction({ transaction, wallet: current(), chain: chainOf(cluster) })).signedTransaction,
      signMessage: async (message) => (await signMessage({ message, wallet: current() })).signature
    });
    return () => registerPrivyBridge(null);
  }, [ready, login, logout, signTransaction, signMessage, cluster]);

  return null;
}

export function PrivyBridge({ appId, cluster }: PrivyBridgeProps) {
  if (!appId) return null;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'google'],
        appearance: { walletChainType: 'solana-only' },
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' }, ethereum: { createOnLogin: 'off' } },
        solana: { rpcs: rpcsFor(cluster) }
      }}
    >
      <Bridge cluster={cluster} />
    </PrivyProvider>
  );
}
