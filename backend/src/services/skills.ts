/**
 * SkillService: ArcNave Item 11 Skills Architecture.
 *
 * Implements:
 * - Filesystem security: scans allowed directories at startup/reload, builds in-memory registry.
 * - Path traversal prevention: model controls ONLY skill name; no dynamic fs.readFile on model input.
 * - Strong frontmatter validation (Zod schema).
 * - Progressive disclosure: lightweight list & search summaries; lazy-loaded full bodies.
 * - Capability / Dependency checks: computes mode ('full' | 'guidance_only' | 'unavailable') based on active tools.
 * - Internal autoload skills (e.g. python-sandbox-patterns).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { z } from 'zod';

import { logger } from '../logger.js';

const log = logger.child({ module: 'skills' });

export type SkillCategory =
  | 'artifact'
  | 'analysis'
  | 'research'
  | 'internal'
  | 'meta'
  | 'general';

export type SkillScope = 'builtin' | 'project' | 'user';

export type SkillMode = 'full' | 'guidance_only' | 'unavailable';

const XML_TAG = /<[^>]*>/;

/**
 * Claude's Agent Skills field rules (platform.claude.com, "Agent Skills", Skill structure):
 * name at most 64 characters of lowercase letters, numbers and hyphens, no XML tags, no reserved
 * words; description non-empty, at most 1024 characters, no XML tags. Every skill's description
 * is in every system prompt, so the length cap is what keeps that list cheap.
 */
const skillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers and hyphens only')
    .refine((n) => !/anthropic|claude/.test(n), 'must not contain "anthropic" or "claude"'),
  version: z.string().default('1.0.0'),
  description: z
    .string()
    .min(1)
    .max(1024)
    .refine((d) => !XML_TAG.test(d), 'must not contain XML tags'),
  category: z
    .enum(['artifact', 'analysis', 'research', 'internal', 'meta', 'general'])
    .default('general'),
  scope: z.enum(['builtin', 'project', 'user']).default('builtin'),
  requires: z
    .object({
      tools: z.array(z.string()).default([]),
      capabilities: z.array(z.string()).default([]),
    })
    .default({ tools: [], capabilities: [] }),
  autoload: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export interface SkillEntry {
  frontmatter: SkillFrontmatter;
  content: string;
}

export interface SkillSummary {
  name: string;
  version: string;
  description: string;
  category: SkillCategory;
  scope: SkillScope;
  autoload: boolean;
  mode: SkillMode;
  missingCapabilities: string[];
  /** Required tools not allowed on this turn; a skill with any is not offered to the model. */
  missingTools: string[];
}

export interface SkillDetail extends SkillSummary {
  content: string;
}

/**
 * Supported backend capabilities verified in ArcNave (ADR-0004 & artifacts service).
 * Used to evaluate honest skill capability modes (full vs guidance_only).
 */
export const SUPPORTED_CAPABILITIES = new Set<string>([
  'artifact.export.docx',
  'artifact.export.xlsx',
  'artifact.export.pptx',
]);

import type { CapabilityRegistry } from '../capabilities/registry.js';

export class SkillService {
  private readonly skills = new Map<string, SkillEntry>();
  /** Skill directories that were not loaded, and why. A skill is never dropped unrecorded. */
  readonly rejected: { dir: string; reason: string }[] = [];
  private loaded = false;
  private skillsBaseDir: string | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly relativeSkillsDir: string = 'skills',
    private readonly capabilityRegistry?: CapabilityRegistry,
  ) {}

  /**
   * Scans predefined allowed directory, parses and validates all SKILL.md files.
   * Safe against path traversal: models only query this populated registry.
   */
  async load(): Promise<void> {
    this.skills.clear();
    this.rejected.length = 0;

    const candidatePaths = [
      path.resolve(this.rootDir, this.relativeSkillsDir),
      path.resolve(this.rootDir, 'backend', this.relativeSkillsDir),
      path.resolve(this.rootDir, '..', this.relativeSkillsDir),
      path.resolve(process.cwd(), this.relativeSkillsDir),
      path.resolve(process.cwd(), 'backend', this.relativeSkillsDir),
    ];

    let skillsPath: string | null = null;
    let entries: string[] = [];

    for (const cand of candidatePaths) {
      try {
        entries = await fs.readdir(cand);
        skillsPath = cand;
        break;
      } catch {
        // Continue searching
      }
    }

    if (!skillsPath) {
      log.warn({ candidatePaths }, 'skills directory not found across candidate paths');
      this.loaded = true;
      return;
    }

    this.skillsBaseDir = skillsPath;

    for (const entry of entries) {
      const entryPath = path.join(skillsPath, entry);
      try {
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
          const skillFilePath = path.join(entryPath, 'SKILL.md');
          try {
            let raw: string;
            try {
              raw = await fs.readFile(skillFilePath, 'utf8');
            } catch {
              // Not a skill directory.
              continue;
            }
            const parsed = this.parseSkillContent(raw, skillFilePath);
            if (typeof parsed === 'string') {
              this.rejected.push({ dir: entry, reason: parsed });
              continue;
            }
            const key = parsed.frontmatter.name;
            // Resources are read from the directory named after the skill (getSkillResource).
            if (key !== entry) {
              this.rejected.push({ dir: entry, reason: `name "${key}" does not match its directory` });
              log.warn({ key, skillFilePath }, 'skill name does not match its directory, skipping');
            } else {
              this.skills.set(key, parsed);
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    this.loaded = true;
    log.info({ count: this.skills.size, rejected: this.rejected }, 'skills registry loaded');
  }

  async reload(): Promise<void> {
    await this.load();
  }

  /** The parsed skill, or why it was rejected. */
  private parseSkillContent(raw: string, filePath: string): SkillEntry | string {
    // Standard YAML frontmatter regex: starts with ---, ends with ---
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      log.warn({ filePath }, 'skill file missing valid frontmatter block');
      return 'no frontmatter block';
    }

    const frontmatterText = match[1]!;
    const content = match[2]!.trim();

    let parsedYaml: unknown;
    try {
      parsedYaml = yaml.parse(frontmatterText);
    } catch (err) {
      log.warn({ err, filePath }, 'skill frontmatter failed YAML parse');
      return 'frontmatter is not valid YAML';
    }

    const validated = skillFrontmatterSchema.safeParse(parsedYaml);
    if (!validated.success) {
      log.warn({ errors: validated.error.format(), filePath }, 'skill frontmatter validation failed');
      return validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }

    return {
      frontmatter: validated.data,
      content,
    };
  }

  private evaluateMode(
    skill: SkillFrontmatter,
    availableTools: Set<string>,
  ): { mode: SkillMode; missingCapabilities: string[]; missingTools: string[] } {
    const requiredTools = skill.requires.tools;
    const requiredCaps = skill.requires.capabilities;

    const missingTools = requiredTools.filter((tool) => !availableTools.has(tool));
    const missingCaps = requiredCaps.filter((cap) => {
      if (this.capabilityRegistry) {
        // Strict: only 'full' capabilities satisfy full mode!
        return !this.capabilityRegistry.isFull(cap);
      }
      return !SUPPORTED_CAPABILITIES.has(cap);
    });
    const allMissing = [...missingTools, ...missingCaps];

    if (allMissing.length === 0) {
      return { mode: 'full', missingCapabilities: [], missingTools: [] };
    }

    // When required capabilities or tools are missing, degrade gracefully to guidance_only
    return { mode: 'guidance_only', missingCapabilities: allMissing, missingTools };
  }

  private toSet(availableTools?: string[] | Set<string>): Set<string> {
    if (!availableTools) return new Set<string>();
    return availableTools instanceof Set ? availableTools : new Set(availableTools);
  }

  /**
   * Lists lightweight skill summaries. Excludes internal skills unless includeInternal is true.
   */
  listSkills(availableTools?: string[] | Set<string>, includeInternal = false): SkillSummary[] {
    const toolSet = this.toSet(availableTools);
    const results: SkillSummary[] = [];

    for (const entry of this.skills.values()) {
      if (entry.frontmatter.category === 'internal' && !includeInternal) {
        continue;
      }
      const { mode, missingCapabilities, missingTools } = this.evaluateMode(entry.frontmatter, toolSet);
      results.push({
        name: entry.frontmatter.name,
        version: entry.frontmatter.version,
        description: entry.frontmatter.description,
        category: entry.frontmatter.category,
        scope: entry.frontmatter.scope,
        autoload: entry.frontmatter.autoload,
        mode,
        missingCapabilities,
        missingTools,
      });
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Deterministic keyword search across skill name, description, category, and metadata.
   */
  searchSkills(
    query: string,
    availableTools?: string[] | Set<string>,
    includeInternal = false,
  ): SkillSummary[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return this.listSkills(availableTools, includeInternal);
    }

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const toolSet = this.toSet(availableTools);
    const scored: { skill: SkillSummary; score: number }[] = [];

    for (const entry of this.skills.values()) {
      if (entry.frontmatter.category === 'internal' && !includeInternal) {
        continue;
      }

      let score = 0;
      const name = entry.frontmatter.name.toLowerCase();
      const desc = entry.frontmatter.description.toLowerCase();
      const cat = entry.frontmatter.category.toLowerCase();

      for (const token of tokens) {
        if (name === token) score += 10;
        else if (name.includes(token)) score += 5;

        if (desc.includes(token)) score += 3;
        if (cat.includes(token)) score += 4;
      }

      if (score > 0) {
        const { mode, missingCapabilities, missingTools } = this.evaluateMode(entry.frontmatter, toolSet);
        scored.push({
          score,
          skill: {
            name: entry.frontmatter.name,
            version: entry.frontmatter.version,
            description: entry.frontmatter.description,
            category: entry.frontmatter.category,
            scope: entry.frontmatter.scope,
            autoload: entry.frontmatter.autoload,
            mode,
            missingCapabilities,
            missingTools,
          },
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score).map((s) => s.skill);
  }

  /**
   * Retrieves a skill by name.
   * Safe against path traversal: resolves strictly via memory map without disk lookup.
   */
  getSkill(name: string, availableTools?: string[] | Set<string>): SkillDetail | null {
    // Sanitize and clean key (prevents any path traversal attempts like '../../foo')
    const key = path.basename(name).toLowerCase().trim();
    const entry = this.skills.get(key);
    if (!entry) return null;

    const toolSet = this.toSet(availableTools);
    const { mode, missingCapabilities, missingTools } = this.evaluateMode(entry.frontmatter, toolSet);

    return {
      name: entry.frontmatter.name,
      version: entry.frontmatter.version,
      description: entry.frontmatter.description,
      category: entry.frontmatter.category,
      scope: entry.frontmatter.scope,
      autoload: entry.frontmatter.autoload,
      mode,
      missingCapabilities,
      missingTools,
      content: entry.content,
    };
  }

  /**
   * Returns autoload skills that should be automatically injected when their triggers match.
   */
  getAutoloadSkills(availableTools?: string[] | Set<string>): SkillDetail[] {
    const toolSet = this.toSet(availableTools);
    const autoloads: SkillDetail[] = [];

    for (const entry of this.skills.values()) {
      if (entry.frontmatter.autoload) {
        const { mode, missingCapabilities, missingTools } = this.evaluateMode(entry.frontmatter, toolSet);
        autoloads.push({
          name: entry.frontmatter.name,
          version: entry.frontmatter.version,
          description: entry.frontmatter.description,
          category: entry.frontmatter.category,
          scope: entry.frontmatter.scope,
          autoload: true,
          mode,
          missingCapabilities,
          missingTools,
          content: entry.content,
        });
      }
    }

    return autoloads;
  }

  /**
   * Safely reads an optional resource or script from a skill directory (e.g. references, templates).
   * Guarded strictly against path traversal.
   */
  async getSkillResource(skillName: string, resourcePath: string): Promise<string | null> {
    if (!this.skillsBaseDir) return null;
    const cleanSkill = path.basename(skillName).toLowerCase().trim();
    if (!this.skills.has(cleanSkill)) return null;

    const skillDir = path.resolve(this.skillsBaseDir, cleanSkill);
    const resolvedPath = path.resolve(skillDir, resourcePath);

    // Path traversal check: must stay strictly inside skillDir
    if (!resolvedPath.startsWith(skillDir + path.sep) && resolvedPath !== skillDir) {
      log.warn({ skillName, resourcePath }, 'path traversal attempt detected in getSkillResource');
      return null;
    }

    try {
      return await fs.readFile(resolvedPath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Safely reads an optional binary resource or template from a skill directory.
   * Guarded strictly against path traversal. Returns raw Buffer without UTF-8 decode.
   */
  async getSkillResourceBuffer(skillName: string, resourcePath: string): Promise<Buffer | null> {
    if (!this.skillsBaseDir) return null;
    const cleanSkill = path.basename(skillName).toLowerCase().trim();
    if (!this.skills.has(cleanSkill)) return null;

    const skillDir = path.resolve(this.skillsBaseDir, cleanSkill);
    const resolvedPath = path.resolve(skillDir, resourcePath);

    // Path traversal check: must stay strictly inside skillDir
    if (!resolvedPath.startsWith(skillDir + path.sep) && resolvedPath !== skillDir) {
      log.warn({ skillName, resourcePath }, 'path traversal attempt detected in getSkillResourceBuffer');
      return null;
    }

    try {
      return await fs.readFile(resolvedPath);
    } catch {
      return null;
    }
  }
}
