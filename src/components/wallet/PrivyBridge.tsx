// Mounts Privy once per page when the server runs on Solana (CHAIN=solana) and registers its wallet in privy-registry,
// so login, transactions and wallet proofs reach it from any island. It draws nothing besides Privy's own modals.
import { PrivyProvider, useLogin, useLogout, usePrivy, type User } from '@privy-io/react-auth';
import { useSignMessage, useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, useRef } from 'react';
import { registerPrivyBridge, type PrivyLogin } from '@/lib/client/privy-registry';

interface PrivyBridgeProps {
  appId: string;
  cluster: string;
}

type SolanaChain = 'solana:mainnet' | 'solana:devnet' | 'solana:testnet';

const chainOf = (cluster: string): SolanaChain => (cluster === 'mainnet-beta' ? 'solana:mainnet' : cluster === 'testnet' ? 'solana:testnet' : 'solana:devnet');

const profileOf = (user: User) => ({
  email: user.email?.address ?? user.google?.email ?? '',
  name: user.google?.name ?? ''
});

interface PendingLogin {
  resolve: (login: PrivyLogin) => void;
  reject: (error: Error) => void;
  profile: { email: string; name: string } | null;
}

function Bridge({ cluster }: { cluster: string }) {
  const { ready, authenticated, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { logout } = useLogout();
  const pendingLogin = useRef<PendingLogin | null>(null);
  // Logins are by email or Google only, so the one Solana wallet is the embedded one Privy created for the user.
  const wallet = authenticated ? wallets[0] ?? null : null;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const userRef = useRef(user);
  userRef.current = user;

  const { login } = useLogin({
    onComplete: ({ user: loggedIn }) => {
      if (pendingLogin.current) pendingLogin.current.profile = profileOf(loggedIn);
    },
    onError: (error) => {
      pendingLogin.current?.reject(new Error(error === 'exited_auth_flow' ? 'Cerraste el acceso antes de terminar.' : 'No se pudo iniciar sesión con Privy.'));
      pendingLogin.current = null;
    }
  });

  // The login settles once Privy created (or found) the user's Solana wallet, which arrives after onComplete.
  useEffect(() => {
    const pending = pendingLogin.current;
    if (!pending?.profile || !walletsReady || !wallet) return;
    pendingLogin.current = null;
    pending.resolve({ ...pending.profile, address: wallet.address });
  }, [wallet, walletsReady, user]);

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
          pendingLogin.current?.reject(new Error('Se abrió otro acceso.'));
          // Logged in but its wallet not loaded yet: the effect above settles it when it arrives.
          const known = userRef.current;
          pendingLogin.current = { resolve, reject, profile: known ? profileOf(known) : null };
          if (!known) login();
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
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' }, ethereum: { createOnLogin: 'off' } }
      }}
    >
      <Bridge cluster={cluster} />
    </PrivyProvider>
  );
}
