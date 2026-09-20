/**
 * Privacy and Secret Detection for Persistent Memory.
 *
 * Prevents API keys, credentials, connection strings, private keys,
 * and high-entropy sensitive tokens from being persisted in cross-session memory.
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

export interface PrivacyCheckResult {
  hasSecret: boolean;
  violations: string[];
}

/**
 * Checks whether content contains detectable secrets or sensitive credentials.
 */
export function checkPrivacy(content: string): PrivacyCheckResult {
  if (!content) return { hasSecret: false, violations: [] };

  const violations: string[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(name);
    }
  }

  return {
    hasSecret: violations.length > 0,
    violations,
  };
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
