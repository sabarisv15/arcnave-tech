/**
 * Privacy and Secret Detection for Persistent Memory.
 *
 * Prevents API keys, credentials, connection strings, private keys,
 * and high-entropy sensitive tokens from being persisted in cross-session memory.
 *
 * ADR-0052: also the identifier numbers the reference never stores under any setting
 * (government IDs, payment cards, financial accounts). The model is told the same list; this is
 * the check that holds when it forgets. Checksummed formats (card, Aadhaar) are matched only when
 * the checksum holds, and bare-digit formats only next to the word that names them, so an order
 * number or a phone number is not refused as an ID.
 */

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Private Key', pattern: /-----BEGIN\s+([A-Z0-9_-]+\s+)?PRIVATE\s+KEY-----/i },
  { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Google API Key', pattern: /AIza[0-9A-Za-z-_]{35}/ },
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', pattern: /gh[pousr]-[A-Za-z0-9_]{36,}/ },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9a-zA-Z]{10,}/ },
  { name: 'Database Connection String with Credentials', pattern: /[a-zA-Z0-9_+.-]+:\/\/[^:\s]+:[^@\s]+@[a-zA-Z0-9.-]+/ },
  { name: 'Bearer Token / JWT', pattern: /bearer\s+eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/i },
  { name: 'Generic Password Assignment', pattern: /(?:password|secret|passwd|token)\s*[:=]\s*['"][^\s'"]{6,}['"]/i },
];

/** Luhn check: every payment card number passes it. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Verhoeff tables: every Aadhaar number carries a Verhoeff check digit (UIDAI).
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeff(digits: string): boolean {
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(digits[digits.length - 1 - i])]!]!;
  }
  return c === 0;
}

/** Identifier numbers memory never stores, for anyone (ADR-0052). */
const NEVER_STORED: Array<{ name: string; found: (text: string) => boolean }> = [
  {
    name: 'payment card number',
    found: (t) =>
      [...t.matchAll(/(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g)].some((m) => {
        const digits = m[0].replace(/[ -]/g, '');
        return digits.length >= 13 && digits.length <= 19 && luhn(digits);
      }),
  },
  {
    name: 'Aadhaar number',
    found: (t) =>
      [...t.matchAll(/(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g)].some((m) => verhoeff(m[0].replace(/[ -]/g, ''))),
  },
  // PAN: five letters (the fourth names the holder type), four digits, a letter.
  { name: 'PAN number', found: (t) => /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/.test(t) },
  { name: 'social security number', found: (t) => /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/.test(t) },
  {
    name: 'passport number',
    found: (t) =>
      [...t.matchAll(/\bpassport\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9]{7,9})\b/gi)].some((m) => /\d{6}/.test(m[1]!)),
  },
  {
    name: 'driving licence number',
    found: (t) =>
      [...t.matchAll(/\b(?:driving|driver'?s?)\s+licen[cs]e\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z0-9][A-Z0-9 -]{6,18}\d)\b/gi)].some(
        (m) => (m[1]!.match(/\d/g) ?? []).length >= 8,
      ),
  },
  { name: 'voter ID number', found: (t) => /\b(?:voter\s*id|epic)\s*(?:card\s*)?(?:no\.?|number|#)?\s*[:-]?\s*[A-Z]{3}\d{7}\b/i.test(t) },
  {
    name: 'bank account number',
    found: (t) => /\b(?:a\/c|acct|account|bank\s+account)\s*(?:no\.?|number|#)?\s*[:-]?\s*\d{9,18}\b/i.test(t),
  },
];

export interface PrivacyCheckResult {
  /** Anything that memory refuses: a secret or a never-stored identifier. */
  hasSecret: boolean;
  violations: string[];
  /** The secrets and credentials among the violations (the rest are identifier numbers). */
  secrets: string[];
}

/**
 * Checks whether content contains detectable secrets, credentials or never-stored identifiers.
 */
export function checkPrivacy(content: string): PrivacyCheckResult {
  if (!content) return { hasSecret: false, violations: [], secrets: [] };

  const secrets: string[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) secrets.push(name);
  }
  const identifiers = NEVER_STORED.filter(({ found }) => found(content)).map(({ name }) => name);
  const violations = [...secrets, ...identifiers];

  return {
    hasSecret: violations.length > 0,
    violations,
    secrets,
  };
}

/**
 * The refusal the model and the settings screen show: it names what memory never stores, so the
 * model can say "I'm not able to save ... to memory" and save the rest (ADR-0052).
 */
export function neverStoredMessage(result: PrivacyCheckResult): string {
  return `Memory never stores ${result.violations.join(', ')}. Leave that detail out and save the rest.`;
}

/**
 * Redacts any detected secrets in text for safe logging or error reporting.
 */
export function redactSecrets(content: string): string {
  if (!content) return content;
  let result = content;
  for (const { pattern } of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED_SECRET]');
  }
  return result;
}
