// Where a login lands, whichever way the user logged in.
import type { StoredUser } from './account';
import { CREATE_COMPANY_PATH, hasCompanyIntent, hasOwnCompany } from './company-signup';
import { pendingInvite } from './invitations';
import { hasPendingClaim, hasPendingTransfer } from './qr';
import { pendingCompanyInvitation } from './workspace';

export const pathAfterLogin = (user: StoredUser) => {
  // An invitation link opened before logging in comes first: the login was only the way to answer it.
  const invite = pendingInvite();
  if (invite) return `/invite#t=${invite}`;
  if (hasPendingClaim() || hasPendingTransfer()) return '/app';
  if (pendingCompanyInvitation(user.email)) return '/choose-workspace';
  if (hasOwnCompany(user)) return '/company';
  // Came to register a company: the account exists now, the company is the next step.
  return hasCompanyIntent() ? CREATE_COMPANY_PATH : '/app';
};
