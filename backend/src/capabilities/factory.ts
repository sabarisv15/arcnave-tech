import type { Config } from '../config.js';
import { InMemoryCapabilityRegistry } from './registry.js';

/**
 * Builds the default runtime CapabilityRegistry for an ArcNave instance.
 */
export function buildCapabilityRegistry(cfg: Config): InMemoryCapabilityRegistry {
  const reg = new InMemoryCapabilityRegistry();

  // Project knowledge tools
  reg.register({
    id: 'project.search',
    status: cfg.ENABLE_TOOL_USE ? 'full' : 'unavailable',
    source: 'search_project_files',
    limitation: 'Requires project context and lexical BM25 index.',
  });
  reg.register({
    id: 'project.read',
    status: cfg.ENABLE_TOOL_USE ? 'full' : 'unavailable',
    source: 'read_project_file',
    limitation: 'Bounded character length per read.',
  });

  reg.register({
    id: 'file.read.pdf',
    status: 'full',
    source: 'gemini.describeMedia / pdf-parse',
  });

  // Web tools: web.search is 'full' ONLY if ENABLE_WEB is on AND a live adapter API key is configured.
  // Without a live search key, web.search is 'unavailable' (we do not claim fake partial search).
  const webEnabled = Boolean((cfg as any).ENABLE_WEB);
  const hasLiveSearchConfig = Boolean(
    (cfg as any).SERPAPI_API_KEY?.trim() ||
      ((cfg as any).GOOGLE_SEARCH_API_KEY?.trim() && (cfg as any).GOOGLE_SEARCH_ENGINE_ID?.trim()),
  );

  const webSearchStatus: 'full' | 'partial' | 'unavailable' =
    webEnabled && hasLiveSearchConfig ? 'full' : 'unavailable';

  reg.register({
    id: 'web.search',
    status: webSearchStatus,
    source: 'web_search',
    limitation: hasLiveSearchConfig
      ? undefined
      : 'No live external search provider API key (SERPAPI_API_KEY or GOOGLE_SEARCH_API_KEY/ENGINE_ID) configured.',
  });
  reg.register({
    id: 'web.fetch',
    status: webEnabled ? 'full' : 'unavailable',
    source: 'web_fetch',
    limitation: 'HTTP/HTTPS only, strict SSRF bounds, bounded response size.',
  });

  // Provider web grounding
  reg.register({
    id: 'web.grounding',
    status:
      cfg.ENABLE_GOOGLE_SEARCH_GROUNDING || cfg.ENABLE_ANTHROPIC_WEB_SEARCH
        ? 'full'
        : 'unavailable',
    source: 'provider-native grounding',
  });

  // Python execution
  reg.register({
    id: 'python.execute',
    status: cfg.ENABLE_RUN_PYTHON ? 'full' : 'unavailable',
    source: 'bash_tool, view, create_file, str_replace, present_files',
    limitation: 'Cloud Run isolated sandbox with timeouts and memory bounds.',
  });

  // Artifact Exporters: All four formats satisfy full contracts with format-native renderers and verifiers
  reg.register({
    id: 'artifact.export.docx',
    status: 'full',
    source: 'DocumentService (docxRenderer)',
    limitation: undefined,
  });
  reg.register({
    id: 'artifact.export.xlsx',
    status: 'full',
    source: 'DocumentService (xlsxRenderer)',
    limitation: undefined,
  });
  reg.register({
    id: 'artifact.export.pptx',
    status: 'full',
    source: 'DocumentService (pptxRenderer)',
    limitation: undefined,
  });
  reg.register({
    id: 'artifact.export.pdf',
    status: 'full',
    source: 'DocumentService (pdfRenderer)',
    limitation: undefined,
  });

  // Skills
  reg.register({
    id: 'skills.discover',
    status: cfg.ENABLE_SKILLS ? 'full' : 'unavailable',
    source: '<available_skills> in the prompt',
  });
  reg.register({
    id: 'skills.read',
    status: cfg.ENABLE_SKILLS ? 'full' : 'unavailable',
    source: 'view /skills/<name>/SKILL.md',
  });

  return reg;
}
