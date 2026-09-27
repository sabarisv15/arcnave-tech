/**
 * Which sandbox engine the configuration selects, for the tools and prompt that describe it.
 * The tool list itself is in registry.ts: every allowed tool is declared on every turn (ADR-0047).
 */
import type { Config } from '../config.js';

/**
 * Whether the sandbox can open Office files (xlrd, python-docx, python-pptx, pandoc): the warm
 * service image has them (Dockerfile.service); the single-use Cloud Run Job image does not
 * (sandbox/Dockerfile). The process engine is local development, expected to mirror the warm
 * image. Office text is kept inline when this is false (ADR-0045).
 */
export function sandboxReadsOfficeFiles(cfg: Config): boolean {
  return usesWarmSandbox(cfg) || cfg.SANDBOX_ENGINE === 'process';
}

/** Whether the sandbox runs on the warm service (ADR-0010), mirroring container.ts. */
export function usesWarmSandbox(cfg: Config): boolean {
  return cfg.SANDBOX_ENGINE === 'warm' || (cfg.SANDBOX_ENGINE === 'auto' && Boolean(cfg.SANDBOX_SERVICE_URL));
}
