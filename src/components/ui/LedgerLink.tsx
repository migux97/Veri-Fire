import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface LedgerLinkProps {
  href: string;
  title?: string | undefined;
  children: ReactNode;
}

// Subtle link to a public Solana transaction, opened in a new tab.
export function LedgerLink({ href, title, children }: LedgerLinkProps) {
  return (
    <a className="ledger-link" href={href} target="_blank" rel="noopener noreferrer" title={title}>
      {children} <Icon name="fa-solid fa-arrow-up-right-from-square" />
      <span className="visually-hidden"> (se abre en una pestaña nueva)</span>
    </a>
  );
}
