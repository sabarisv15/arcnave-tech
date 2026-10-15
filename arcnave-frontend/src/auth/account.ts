/**
 * Small, pure helpers for showing "who" on the sign-in boards (S7-SignedOut, S7-Expired, S4-Invite).
 * The boards show an e-mail masked after its first letter ("p••••@psgtech.ac.in") so a screen left
 * open on a shared computer, or a forwarded link, reveals little.
 */

/** "priya@psgtech.ac.in" -> "p••••@psgtech.ac.in". An address without "@" is masked entirely. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email ? "•••••" : "";
  return `${email.slice(0, 1)}••••${email.slice(at)}`;
}

/** Two letters for the avatar: first letters of the first two words of the name, else of the e-mail. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const source = words.length ? words : [email.trim()];
  const letters = source.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

/** First word of the name, for "See you soon, Priya."; empty when the account has no name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
