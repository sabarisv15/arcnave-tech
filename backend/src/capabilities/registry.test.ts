import { describe, expect, it } from 'vitest';
import { InMemoryCapabilityRegistry } from './registry.js';
import { buildCapabilityRegistry } from './factory.js';
import { loadConfig } from '../config.js';

describe('CapabilityRegistry', () => {
  it('strictly distinguishes isFull and isAvailable on partial status', () => {
    const reg = new InMemoryCapabilityRegistry([
      { id: 'test.full', status: 'full' },
      { id: 'test.partial', status: 'partial', limitation: 'no tables' },
      { id: 'test.none', status: 'unavailable' },
    ]);

    expect(reg.status('test.full')).toBe('full');
    expect(reg.isFull('test.full')).toBe(true);
    expect(reg.isAvailable('test.full')).toBe(true);

    expect(reg.status('test.partial')).toBe('partial');
    expect(reg.isFull('test.partial')).toBe(false); // CRITICAL: partial must NOT be full!
    expect(reg.isAvailable('test.partial')).toBe(true);

    expect(reg.status('test.none')).toBe('unavailable');
    expect(reg.isFull('test.none')).toBe(false);
    expect(reg.isAvailable('test.none')).toBe(false);

    expect(reg.status('unknown')).toBe('unavailable');
    expect(reg.isFull('unknown')).toBe(false);
    expect(reg.isAvailable('unknown')).toBe(false);
  });

  it('builds registry correctly according to config flags', () => {
    const devCfg = loadConfig({
      ENABLE_TOOL_USE: 'true',
      ENABLE_RUN_PYTHON: 'false',
      ENABLE_SKILLS: 'true',
      ENABLE_AGENT_LOOP: 'false',
    });

    const reg = buildCapabilityRegistry(devCfg);
    expect(reg.isFull('project.search')).toBe(true);
    expect(reg.isFull('artifact.create')).toBe(true);
    expect(reg.isFull('python.execute')).toBe(false);
    expect(reg.isFull('skills.discover')).toBe(true);
    expect(reg.isFull('agent.loop')).toBe(false);
  });
});
