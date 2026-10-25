import type { Session } from "./session.js";

/**
 * The owner allow-list is a comma-separated secret compared case-insensitively:
 * an email's case is not a credential, and a mismatch would close the only
 * door into the queue. An account whose address is verified is required first:
 * an unverified address is not a claim to an allow-list entry. An empty secret
 * matches nobody, and neither does a session with no email — otherwise a
 * whitespace-only secret's blank entry would admit it.
 */
export function isOwner(session: Session, ownerEmails: string): boolean {
  if (session.emailVerified !== true) return false;
  const email = session.email.trim().toLowerCase();
  if (email.length === 0) return false;
  return ownerEmails
    .split(",")
    .some((candidate) => candidate.trim().toLowerCase() === email);
}
