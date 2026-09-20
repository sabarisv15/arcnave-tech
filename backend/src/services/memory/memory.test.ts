import { describe, expect, it } from 'vitest';
import { checkPrivacy, redactSecrets } from './privacy.js';

describe('Phase 5.2 Persistent Memory - Privacy & Secrets', () => {
  it('detects OpenAI API keys', () => {
    const text = 'Here is my key: sk-abcdef1234567890abcdef1234567890';
    const result = checkPrivacy(text);
    expect(result.hasSecret).toBe(true);
    expect(result.violations).toContain('OpenAI API Key');
    expect(redactSecrets(text)).toContain('[REDACTED_SECRET]');
  });

  it('detects Google API keys', () => {
    const text = 'API key AIzaSyD1234567890abcdef1234567890abcdef1';
    const result = checkPrivacy(text);
    expect(result.hasSecret).toBe(true);
    expect(result.violations).toContain('Google API Key');
  });

  it('detects private keys', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const result = checkPrivacy(text);
    expect(result.hasSecret).toBe(true);
    expect(result.violations).toContain('Private Key');
  });

  it('detects connection strings with passwords', () => {
    const text = 'postgres://postgres:secretpassword123@localhost:5432/arcnave';
    const result = checkPrivacy(text);
    expect(result.hasSecret).toBe(true);
    expect(result.violations).toContain('Database Connection String with Credentials');
  });

  it('detects passwords in key-value pairs', () => {
    const text = 'password: "mysecretpass123"';
    const result = checkPrivacy(text);
    expect(result.hasSecret).toBe(true);
    expect(result.violations).toContain('Generic Password Assignment');
  });

  it('allows benign user statements without secrets', () => {
    const text = 'I prefer concise answers with code snippets in TypeScript.';
    const result = checkPrivacy(text);
    expect(result.hasSecret).toBe(false);
    expect(result.violations).toHaveLength(0);
    expect(redactSecrets(text)).toBe(text);
  });
});
