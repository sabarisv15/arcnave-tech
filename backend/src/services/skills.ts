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

const skillFrontmatterSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().default('1.0.0'),
  description: z.string().min(1),
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

export class SkillService {
  private readonly skills = new Map<string, SkillEntry>();
  private loaded = false;

  constructor(
    private readonly rootDir: string,
    private readonly relativeSkillsDir: string = 'skills',
  ) {}

  /**
   * Scans predefined allowed directory, parses and validates all SKILL.md files.
   * Safe against path traversal: models only query this populated registry.
   */
  async load(): Promise<void> {
    this.skills.clear();
    const skillsPath = path.resolve(this.rootDir, this.relativeSkillsDir);

    let entries: string[];
    try {
      entries = await fs.readdir(skillsPath);
    } catch (err) {
      log.warn({ err, skillsPath }, 'skills directory not found or unreadable');
      this.loaded = true;
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(skillsPath, entry);
      try {
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
          const skillFilePath = path.join(entryPath, 'SKILL.md');
          try {
            const raw = await fs.readFile(skillFilePath, 'utf8');
            const parsed = this.parseSkillContent(raw, skillFilePath);
            if (parsed) {
              const key = parsed.frontmatter.name.toLowerCase().trim();
              if (this.skills.has(key)) {
                log.warn({ key, skillFilePath }, 'duplicate skill name encountered, skipping');
              } else {
                this.skills.set(key, parsed);
              }
            }
          } catch (fileErr) {
            // No SKILL.md in this subdirectory or file unreadable
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    this.loaded = true;
    log.info({ count: this.skills.size }, 'skills registry loaded');
  }

  async reload(): Promise<void> {
    await this.load();
  }

  private parseSkillContent(raw: string, filePath: string): SkillEntry | null {
    // Standard YAML frontmatter regex: starts with ---, ends with ---
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      log.warn({ filePath }, 'skill file missing valid frontmatter block');
      return null;
    }

    const frontmatterText = match[1]!;
    const content = match[2]!.trim();

    let parsedYaml: unknown;
    try {
      parsedYaml = yaml.parse(frontmatterText);
    } catch (err) {
      log.warn({ err, filePath }, 'skill frontmatter failed YAML parse');
      return null;
    }

    const validated = skillFrontmatterSchema.safeParse(parsedYaml);
    if (!validated.success) {
      log.warn({ errors: validated.error.format(), filePath }, 'skill frontmatter validation failed');
      return null;
    }

    return {
      frontmatter: validated.data,
      content,
    };
  }

  private evaluateMode(
    skill: SkillFrontmatter,
    availableTools: Set<string>,
  ): { mode: SkillMode; missingCapabilities: string[] } {
    const requiredTools = skill.requires.tools;
    const requiredCaps = skill.requires.capabilities;

    const missingTools = requiredTools.filter((tool) => !availableTools.has(tool));
    const missingCaps = requiredCaps.filter((cap) => !SUPPORTED_CAPABILITIES.has(cap));
    const allMissing = [...missingTools, ...missingCaps];

    if (allMissing.length === 0) {
      return { mode: 'full', missingCapabilities: [] };
    }

    // When required capabilities or tools are missing, degrade gracefully to guidance_only
    return { mode: 'guidance_only', missingCapabilities: allMissing };
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
      const { mode, missingCapabilities } = this.evaluateMode(entry.frontmatter, toolSet);
      results.push({
        name: entry.frontmatter.name,
        version: entry.frontmatter.version,
        description: entry.frontmatter.description,
        category: entry.frontmatter.category,
        scope: entry.frontmatter.scope,
        autoload: entry.frontmatter.autoload,
        mode,
        missingCapabilities,
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
        const { mode, missingCapabilities } = this.evaluateMode(entry.frontmatter, toolSet);
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
    const { mode, missingCapabilities } = this.evaluateMode(entry.frontmatter, toolSet);

    return {
      name: entry.frontmatter.name,
      version: entry.frontmatter.version,
      description: entry.frontmatter.description,
      category: entry.frontmatter.category,
      scope: entry.frontmatter.scope,
      autoload: entry.frontmatter.autoload,
      mode,
      missingCapabilities,
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
        const { mode, missingCapabilities } = this.evaluateMode(entry.frontmatter, toolSet);
        autoloads.push({
          name: entry.frontmatter.name,
          version: entry.frontmatter.version,
          description: entry.frontmatter.description,
          category: entry.frontmatter.category,
          scope: entry.frontmatter.scope,
          autoload: true,
          mode,
          missingCapabilities,
          content: entry.content,
        });
      }
    }

    return autoloads;
  }
}
