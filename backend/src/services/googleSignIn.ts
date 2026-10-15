/**
 * Google sign-in (ADR-0056): verify a Google Identity Services ID token.
 *
 * The browser gets the token from Google's own button; the server checks its signature, issuer,
 * expiry and audience with `google-auth-library` against our OAuth client id. Nothing from the
 * token is trusted until that check passes. The verifier is a container seam so tests never call
 * Google.
 */
import { OAuth2Client } from 'google-auth-library';

import { ApiError } from '../errors.js';

/** What sign-in needs from a verified token. */
export interface GoogleIdentity {
  /** Google's stable account id (`sub`). */
  subject: string;
  email: string;
  /** Google says it confirmed the address (`email_verified`). Unverified addresses never link. */
  emailVerified: boolean;
  name: string;
}

export interface GoogleTokenVerifier {
  /** Resolves to the token's identity, or throws `invalid_credentials`. */
  verify(idToken: string): Promise<GoogleIdentity>;
}

export class GisTokenVerifier implements GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly clientId: string) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      payload = ticket.getPayload();
    } catch {
      // The library's message names the failed check; the client only needs to know it failed.
      throw new ApiError('invalid_credentials', { detail: 'Google could not confirm this sign-in. Try again.' });
    }
    if (!payload?.sub || !payload.email) {
      throw new ApiError('invalid_credentials', { detail: 'Google did not share an e-mail address for this account.' });
    }
    return {
      subject: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? '',
    };
  }
}
