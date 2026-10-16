/**
 * Request-edge rules without a database (ADR-0065): the Origin decision table, the client
 * address behind a proxy, headers on a raw-written response, and the DOCS_ENABLED rule.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import securityPlugin, { API_SECURITY_HEADERS, originAllowed, trustProxyHops } from './security.js';

const ALLOWED = new Set(['https://www.arcnave.tech', 'http://localhost:5173']);

describe('originAllowed', () => {
  it('lets reads through whatever their origin', () => {
    expect(originAllowed('GET', 'https://evil.example', 'cross-site', ALLOWED)).toBe(true);
    expect(originAllowed('OPTIONS', 'https://evil.example', 'cross-site', ALLOWED)).toBe(true);
  });

  it('requires an allow-listed Origin on every state-changing method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(originAllowed(method, 'https://www.arcnave.tech', 'cross-site', ALLOWED), method).toBe(true);
      expect(originAllowed(method, 'https://evil.example', 'cross-site', ALLOWED), method).toBe(false);
      expect(originAllowed(method, 'null', undefined, ALLOWED), method).toBe(false);
      expect(originAllowed(method, 'https://accounts.google.com', 'cross-site', ALLOWED), method).toBe(false);
    }
  });

  it('refuses a cross-site request with no Origin, allows a client that is not a browser', () => {
    expect(originAllowed('POST', undefined, 'cross-site', ALLOWED)).toBe(false);
    expect(originAllowed('POST', undefined, 'same-site', ALLOWED)).toBe(false);
    expect(originAllowed('POST', undefined, 'same-origin', ALLOWED)).toBe(true);
    expect(originAllowed('POST', undefined, 'none', ALLOWED)).toBe(true);
    expect(originAllowed('POST', undefined, undefined, ALLOWED)).toBe(true);
  });

  it('allows a same-origin request whose origin is not listed (app and API behind one proxy)', () => {
    expect(originAllowed('POST', 'http://127.0.0.1:3000', 'same-origin', ALLOWED)).toBe(true);
    // Without the browser's same-origin mark, the unlisted origin is still refused.
    expect(originAllowed('POST', 'http://127.0.0.1:3000', undefined, ALLOWED)).toBe(false);
    expect(originAllowed('POST', 'http://127.0.0.1:3000', 'cross-site', ALLOWED)).toBe(false);
  });
});

describe('trustProxyHops', () => {
  async function ipFor(hops: number, remoteAddress: string, xff?: string): Promise<string> {
    const app = Fastify({ trustProxy: trustProxyHops(hops) });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      ...(xff ? { headers: { 'x-forwarded-for': xff } } : {}),
    });
    await app.close();
    return (res.json() as { ip: string }).ip;
  }

  it('with one hop, the client is the entry the proxy appended; a client-written entry is ignored', async () => {
    expect(await ipFor(1, '35.191.0.9', '203.0.113.7')).toBe('203.0.113.7');
    expect(await ipFor(1, '35.191.0.9', '1.1.1.1, 203.0.113.7')).toBe('203.0.113.7');
    expect(await ipFor(1, '35.191.0.9', '9.9.9.9, 8.8.8.8, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('with zero hops, no header is read', async () => {
    expect(await ipFor(0, '35.191.0.9', '203.0.113.7')).toBe('35.191.0.9');
  });

  it('a plain number would trust nothing in this Fastify version (why a function is used)', async () => {
    const app = Fastify({ trustProxy: 1 as unknown as boolean });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    const res = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '35.191.0.9', headers: { 'x-forwarded-for': '203.0.113.7' } });
    await app.close();
    expect((res.json() as { ip: string }).ip).toBe('35.191.0.9');
  });
});

describe('security headers', () => {
  it('reach a response the handler writes itself (the SSE path)', async () => {
    const app = Fastify();
    await app.register(securityPlugin, { allowedOrigins: [] });
    app.get('/raw', (_request, reply) => {
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.end('data: x\n\n');
    });
    const res = await app.inject({ method: 'GET', url: '/raw' });
    await app.close();
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(res.headers[name.toLowerCase()], name).toBe(value);
    }
    expect(res.headers['content-type']).toBe('text/event-stream');
  });

  it('puts the CSP in report-only mode with frame-ancestors none, and enforces no-framing', () => {
    expect(API_SECURITY_HEADERS['Content-Security-Policy-Report-Only']).toContain("frame-ancestors 'none'");
    expect(Object.keys(API_SECURITY_HEADERS)).not.toContain('Content-Security-Policy');
    expect(API_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
  });
});

describe('DOCS_ENABLED', () => {
  const production = {
    NODE_ENV: 'production',
    COOKIE_SECRET: 'x'.repeat(40),
    SESSION_COOKIE_SECURE: 'true',
    CORS_ORIGINS: 'https://app.example.test',
  };

  it('defaults on outside production and off in production', () => {
    expect(loadConfig({}).docsEnabled).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test' }).docsEnabled).toBe(true);
    expect(loadConfig(production).docsEnabled).toBe(false);
    expect(loadConfig({ ...production, DOCS_ENABLED: '' }).docsEnabled).toBe(false);
  });

  it('an explicit value wins in any environment', () => {
    expect(loadConfig({ ...production, DOCS_ENABLED: 'true' }).docsEnabled).toBe(true);
    expect(loadConfig({ DOCS_ENABLED: 'false' }).docsEnabled).toBe(false);
  });
});
