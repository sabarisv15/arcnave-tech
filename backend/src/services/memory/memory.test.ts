import { describe, expect, it } from 'vitest';
import { checkPrivacy, neverStoredMessage, redactSecrets } from './privacy.js';

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

// ADR-0052: the identifier numbers memory never stores, for anyone, under any setting. The
// Aadhaar values were derived with an independent Verhoeff check-digit generator, not by hand.
describe('never-stored identifier numbers', () => {
  it.each([
    ['my card is 4111 1111 1111 1111', 'payment card number'],
    ['card 4111111111111111', 'payment card number'],
    ['aadhaar 2345 6789 0124', 'Aadhaar number'],
    ['PAN ABCPE1234F', 'PAN number'],
    ['ssn 123-45-6789', 'social security number'],
    ['passport number: K1234567', 'passport number'],
    ['driving licence TN01 20110012345', 'driving licence number'],
    ['voter id ABC1234567', 'voter ID number'],
    ['account no 123456789012', 'bank account number'],
  ])('refuses %s', (text, name) => {
    const result = checkPrivacy(text);
    expect(result.hasSecret).toBe(true);
    expect(result.violations).toContain(name);
    expect(result.secrets).toEqual([]);
    expect(neverStoredMessage(result)).toBe(`Memory never stores ${name}. Leave that detail out and save the rest.`);
  });

  it.each([
    'call me on +91 98765 43210',
    'the Visa ending in 4417',
    'visited in 2019 and 2023',
    'order 1234567890123',
    'ref 2345 6789 0125',
    'passport renewal next month, 2 weeks',
    'driving license renewal next month 2',
    'banks with SBI; account opened in 2021',
  ])('keeps %s, which names no identifier', (text) => {
    expect(checkPrivacy(text).violations).toEqual([]);
  });
});
