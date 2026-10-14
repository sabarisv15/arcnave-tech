/**
 * Registration, sign-in, and server-side sessions.
 *
 * Passwords use Argon2id (`@node-rs/argon2`), the current OWASP first choice for new
 * applications. Session tokens are 256 bits of CSPRNG entropy; only the SHA-256 of the token
 * is stored, so reading the `sessions` table does not yield a usable credential.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { hash as argonHash, parseOptions, verify as argonVerify } from '@node-rs/argon2';
import { and, eq, gt, lt } from 'drizzle-orm';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { preferences, sessions, users } from '../db/schema.js';
import { ApiError } from '../errors.js';
import type { GoogleIdentity } from './googleSignIn.js';

export const MIN_PASSWORD_LENGTH = 12;
/** Argon2 has no practical input limit; this bounds the work an attacker can force per try. */
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * Length is the only rule.
 *
 * Composition rules ("one digit, one symbol") push people toward predictable substitutions
 * without adding real entropy; NIST dropped them for that reason.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Our current Argon2id policy.
 *
 * These match the library defaults today; naming them explicitly is what lets `needsRehash`
 * detect a stored hash produced under weaker parameters, including by an older library
 * version whose defaults were lower.
 */
/**
 * `Algorithm.Argon2id` is an ambient const enum, which `verbatimModuleSyntax` forbids
 * importing, so its value (2) is inlined here with the same meaning.
 */
const ARGON2ID = 2;

const ARGON_POLICY = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_POLICY);
}

/**
 * True when a stored hash was produced with weaker parameters than we now require.
 *
 * `@node-rs/argon2` exposes `parseOptions` rather than a ready-made helper, so the comparison
 * is explicit. An unparseable hash counts as needing a rehash.
 */
export function needsRehash(passwordHash: string): boolean {
  try {
    const parsed = parseOptions(passwordHash);
    return (
      parsed.algorithm !== ARGON_POLICY.algorithm ||
      parsed.memoryCost < ARGON_POLICY.memoryCost ||
      parsed.timeCost < ARGON_POLICY.timeCost ||
      parsed.parallelism !== ARGON_POLICY.parallelism ||
      parsed.outputLen < ARGON_POLICY.outputLen
    );
  } catch {
    return true;
  }
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a 500 that tells an
    // attacker something about the account.
    return false;
  }
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

export interface SessionResult {
  user: AuthedUser;
  token: string;
  expiresAt: Date;
}

/**
 * A dummy Argon2 hash, verified against when an email does not exist.
 *
 * Without it, "unknown email" returns in microseconds while "wrong password" takes ~100ms,
 * which turns the login endpoint into an account-enumeration oracle.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$8vJ7Wc0nQZ3lqQxJ9kKqKQXKZ0kDqYmMZ0PqZ9YQX0k';

/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * True for a unique-constraint violation, however deeply it is wrapped.
 *
 * Drizzle wraps driver errors in its own error type and puts the `postgres.js` error on
 * `cause`, so checking `err.code` alone silently misses every constraint violation and turns
 * an expected 409 into a 500.
 */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
  ) {}

  async register(email: string, password: string, name: string): Promise<SessionResult> {
    const problem = passwordProblem(password);
    if (problem) throw new ApiError('weak_password', { detail: problem });

    const normalized = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);

    let userId: string;
    try {
      const [created] = await this.db
        .insert(users)
        .values({ email: normalized, passwordHash, name: name.trim() })
        .returning({ id: users.id });
      if (!created) throw new ApiError('internal_error');
      userId = created.id;
    } catch (err) {
      // Unique violation on the case-insensitive email index.
      if (isUniqueViolation(err)) throw new ApiError('email_taken');
      throw err;
    }

    // Every user gets a preferences row at creation, so the rest of the codebase can treat it
    // as guaranteed rather than defaulting a possibly-missing row in a dozen places.
    await this.db.insert(preferences).values({ userId }).onConflictDoNothing();

    return this.issueSession({ id: userId, email: normalized, name: name.trim() }, '');
  }

  async login(email: string, password: string, userAgent: string): Promise<SessionResult> {
    const normalized = email.trim().toLowerCase();
    const [found] = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);

    if (!found?.passwordHash) {
      // Burn comparable time, then fail identically to a wrong password. An account made with
      // Google has no password (ADR-0056) and answers the same way, so this endpoint does not
      // reveal how an address signs in.
      await verifyPassword(password, DUMMY_HASH);
      throw new ApiError('invalid_credentials');
    }
    if (!(await verifyPassword(password, found.passwordHash))) {
      throw new ApiError('invalid_credentials');
    }
    if (!found.isActive) throw new ApiError('forbidden', { detail: 'This account is disabled.' });

    // Opportunistically upgrade the stored hash if the Argon2 parameters have moved on.
    try {
      if (needsRehash(found.passwordHash)) {
        await this.db
          .update(users)
          .set({ passwordHash: await hashPassword(password) })
          .where(eq(users.id, found.id));
      }
    } catch {
      // A failed rehash must never block a valid sign-in.
    }

    return this.issueSession(
      { id: found.id, email: found.email, name: found.name },
      userAgent,
    );
  }

  /**
   * Sign in with a verified Google identity (ADR-0056): the account with that e-mail, or a new
   * password-less one when registration is open. Only an address Google itself verified links,
   * or anyone could claim an account by putting its address on an unverified Google account.
   */
  async loginWithGoogle(identity: GoogleIdentity, userAgent: string): Promise<SessionResult & { created: boolean }> {
    if (!identity.emailVerified) {
      throw new ApiError('invalid_credentials', { detail: 'Google has not verified this e-mail address.' });
    }
    const normalized = identity.email.trim().toLowerCase();
    const existing = await this.findByEmail(normalized);
    if (existing) return { ...(await this.sessionFor(existing, userAgent)), created: false };

    if (!this.cfg.REGISTRATION_ENABLED) throw new ApiError('registration_closed');
    const name = identity.name.trim().slice(0, 120);
    try {
      const [created] = await this.db
        .insert(users)
        .values({ email: normalized, passwordHash: null, name })
        .returning({ id: users.id });
      if (!created) throw new ApiError('internal_error');
      await this.db.insert(preferences).values({ userId: created.id }).onConflictDoNothing();
      return { ...(await this.issueSession({ id: created.id, email: normalized, name }, userAgent)), created: true };
    } catch (err) {
      // Two first sign-ins raced; the other one created the account, so link to it.
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.findByEmail(normalized);
      if (!raced) throw err;
      return { ...(await this.sessionFor(raced, userAgent)), created: false };
    }
  }

  private async findByEmail(email: string): Promise<(AuthedUser & { isActive: boolean }) | undefined> {
    const [found] = await this.db
      .select({ id: users.id, email: users.email, name: users.name, isActive: users.isActive })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return found;
  }

  private sessionFor(user: AuthedUser & { isActive: boolean }, userAgent: string): Promise<SessionResult> {
    if (!user.isActive) throw new ApiError('forbidden', { detail: 'This account is disabled.' });
    return this.issueSession({ id: user.id, email: user.email, name: user.name }, userAgent);
  }

  private async issueSession(user: AuthedUser, userAgent: string): Promise<SessionResult> {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + this.cfg.sessionTtlMs);
    await this.db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: userAgent.slice(0, 300),
    });
    return { user, token, expiresAt };
  }

  /** Resolve a cookie token to a user, or null. Expired rows never authenticate. */
  async resolve(token: string): Promise<AuthedUser | null> {
    if (!token) return null;
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        isActive: users.isActive,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (!row || !row.isActive) return null;

    // Fire-and-forget: a failed last-seen write must not fail the request it decorates.
    void this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId))
      .catch(() => undefined);

    return { id: row.userId, email: row.email, name: row.name };
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  }

  /** Invalidate every session for a user. Used after a password change. */
  async logoutAll(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const problem = passwordProblem(next);
    if (problem) throw new ApiError('weak_password', { detail: problem });

    const [found] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!found?.passwordHash || !(await verifyPassword(current, found.passwordHash))) {
      throw new ApiError('invalid_credentials', {
        detail: 'Your current password is incorrect.',
      });
    }

    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(next) })
      .where(eq(users.id, userId));
    // Changing a password must end other sessions, or a stolen cookie survives the reset.
    await this.logoutAll(userId);
  }

  /** Housekeeping: drop expired sessions. Called on a timer from the app. */
  async purgeExpired(): Promise<number> {
    const removed = await this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .returning({ id: sessions.id });
    return removed.length;
  }
}
