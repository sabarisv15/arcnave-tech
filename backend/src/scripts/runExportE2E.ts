/**
 * Natural Language Request -> Exported Binary End-to-End Suite.
 *
 * Validates the complete deliverable pipeline from end to end:
 * User Prompt -> Real Model Generates Artifact -> renderMarkdownExport -> Format Verifier -> Binary on Disk.
 *
 * Formats:
 * 1. DOCX (Word)
 * 2. XLSX (Excel)
 * 3. PPTX (PowerPoint)
 * 4. PDF  (Publication PDF)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest, ToolCall, ToolDefinition, ToolResult } from '../providers/types.js';
import { loadConfig } from '../config.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { buildBaseSystemPrompt } from '../services/systemPrompt.js';
import { CREATE_ARTIFACT, codeToolDefinitions } from '../tools/definitions.js';
import { renderMarkdownExport } from '../services/documents/index.js';
import { verifyDocx } from '../services/documents/verify/docxVerify.js';
import { verifyXlsx } from '../services/documents/verify/xlsxVerify.js';
import { verifyPptx } from '../services/documents/verify/pptxVerify.js';
import { verifyPdf } from '../services/documents/verify/pdfVerify.js';
import type { ExportFormat, VerificationResult } from '../services/documents/types.js';

interface ExportTestCase {
  format: ExportFormat;
  prompt: string;
  verifier: (buf: Buffer) => Promise<VerificationResult>;
}

const TEST_CASES: ExportTestCase[] = [
  {
    format: 'docx',
    prompt:
      'Create a formal Master Services Agreement Word document (.docx) titled "MSA Agreement". ' +
      'Include a title, sections for Scope of Work, and a table with Milestone, Due Date, and Fee columns. ' +
      'Call create_artifact with kind: "document" and complete clean Markdown.',
    verifier: verifyDocx,
  },
  {
    format: 'xlsx',
    prompt:
      'Create a comprehensive quarterly financial budget spreadsheet (.xlsx) titled "Q1-Q4 Financial Model". ' +
      'Include columns for Quarter, Revenue, OpEx, and Net Profit, with at least 4 rows of data and =SUM formula. ' +
      'Call create_artifact with kind: "document" and standard Markdown table.',
    verifier: verifyXlsx,
  },
  {
    format: 'pptx',
    prompt:
      'Create a 4-slide executive presentation pitch deck (.pptx) titled "Company Pitch Deck". ' +
      'Include slides for Problem, Solution, Market Opportunity, and Team. ' +
      'Use slide headings separated by "---" horizontal rules. Call create_artifact.',
    verifier: verifyPptx,
  },
  {
    format: 'pdf',
    prompt:
      'Create a publication-quality compliance executive report (.pdf) titled "Annual Compliance Summary". ' +
      'Include an executive summary callout, structured headings, and an audit findings table with Severity, Area, and Status columns. ' +
      'Call create_artifact.',
    verifier: verifyPdf,
  },
];

async function main() {
  console.log('======================================================================');
  console.log('  ArcNave Natural Language Request -> Exported Binary E2E Pipeline');
  console.log('======================================================================\n');

  const cfg = loadConfig({
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974',
    VERTEX_LOCATION: 'global',
    MODEL_GEMINI_FLASH: 'gemini-3.8-flash',
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    ENABLE_WEB: 'true',
    ENABLE_SKILLS: 'true',
  });

  const registry = buildCapabilityRegistry(cfg);
  const masterPrompt = buildBaseSystemPrompt(cfg, registry);
  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH || 'gemini-3.8-flash';

  const outDir = path.resolve(process.cwd(), 'test-artifacts', 'e2e-exports');
  await fs.mkdir(outDir, { recursive: true });

  const tools: ToolDefinition[] = [CREATE_ARTIFACT, ...codeToolDefinitions(true)];

  let passed = 0;

  for (const tc of TEST_CASES) {
    console.log(`\n----------------------------------------------------------------------`);
    console.log(`[E2E Export: ${tc.format.toUpperCase()}] Running natural-language request...`);
    console.log(`Prompt: "${tc.prompt.substring(0, 90)}..."`);

    let createdArtifactContent = '';
    let createdArtifactTitle = '';
    let responseText = '';

    const toolExecutor = {
      async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
        console.log(`  -> Model called tool [${call.name}]:`, JSON.stringify(call.input));
        if (call.name === 'create_artifact') {
          const input = call.input as any;
          createdArtifactContent = input?.content || '';
          createdArtifactTitle = input?.title || `Deliverable-${tc.format}`;
          return {
            toolCallId: call.id,
            ok: true,
            content: [
              {
                type: 'json',
                data: {
                  artifactId: `art-${tc.format}-${Date.now()}`,
                  title: createdArtifactTitle,
                  kind: input?.kind || 'document',
                  version: 1,
                  status: 'created',
                },
              },
            ],
          };
        }
        if (call.name === 'read_skill' || call.name === 'load_skill') {
          const name = (call.input as any)?.name;
          return {
            toolCallId: call.id,
            ok: true,
            content: [{ type: 'text', text: `Skill "${name}" loaded with format-native conventions.` }],
          };
        }
        if (call.name === 'list_skills') {
          return {
            toolCallId: call.id,
            ok: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify([
                  { name: 'docx', description: 'Professional Word document generation' },
                  { name: 'xlsx', description: 'Professional Excel spreadsheet generation' },
                  { name: 'pptx', description: 'Professional PowerPoint presentation generation' },
                  { name: 'pdf', description: 'Professional PDF document generation' },
                ]),
              },
            ],
          };
        }
        if (call.name === 'search_skills') {
          const query = (call.input as any)?.query;
          return {
            toolCallId: call.id,
            ok: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify([
                  { name: 'docx', description: 'Word document skill' },
                  { name: 'xlsx', description: 'Spreadsheet skill' },
                  { name: 'pptx', description: 'Presentation skill' },
                  { name: 'pdf', description: 'PDF skill' },
                ]),
              },
            ],
          };
        }
        return {
          toolCallId: call.id,
          ok: true,
          content: [{ type: 'text', text: 'OK' }],
        };
      },
    };

    const req: GenerationRequest = {
      mode: 'chat',
      prompt: tc.prompt,
      systemInstruction: masterPrompt,
      providerModelId: modelId,
      maxOutputTokens: 8192,
      history: [],
      tools,
      toolExecutor,
      signal: new AbortController().signal,
      grounded: false,
      codeExecution: false,
    };

    for await (const ev of provider.stream(req)) {
      if (ev.type === 'delta') {
        responseText += ev.text;
      } else if (ev.type === 'tool_use') {
        console.log(`  -> [Provider Tool Use] ${ev.name} (id: ${ev.toolCallId})`);
      } else if (ev.type === 'completed') {
        console.log(`  -> [Provider Completed] finishReason=${ev.finishReason}, tokens=${ev.usage?.outputTokens}`);
      }
    }

    if (responseText.length > 0) {
      console.log(`  -> Response text preview: "${responseText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    }

    // Fallback: If model output raw markdown directly in chat response without calling create_artifact, use responseText
    const sourceMarkdown = createdArtifactContent.trim() || responseText.trim();

    if (!sourceMarkdown) {
      console.error(`❌ [${tc.format.toUpperCase()}] FAIL: Model did not generate artifact content or text.`);
      console.error(`Debug info: createdArtifactContent len=${createdArtifactContent.length}, responseText len=${responseText.length}`);
      continue;
    }

    console.log(`Artifact created: "${createdArtifactTitle}" (${sourceMarkdown.length} chars)`);

    try {
      // 1. Render through universal deliverable engine
      const binaryBuffer = await renderMarkdownExport(sourceMarkdown, tc.format);
      console.log(`Binary generated: ${binaryBuffer.length.toLocaleString()} bytes`);

      // 2. Run format verifier
      const verification = await tc.verifier(binaryBuffer);
      if (!verification.ok) {
        console.error(`❌ [${tc.format.toUpperCase()}] Verifier failed:`, verification.errors);
        continue;
      }

      // 3. Write verified binary to disk
      const filePath = path.join(outDir, `e2e-output.${tc.format}`);
      await fs.writeFile(filePath, binaryBuffer);

      console.log(`Verified binary saved to: ${filePath}`);
      console.log(`✅ [${tc.format.toUpperCase()}] PASS: End-to-end NL request -> verified binary complete.`);
      passed += 1;
    } catch (err: any) {
      console.error(`❌ [${tc.format.toUpperCase()}] Generation/Verification error:`, err?.message || err);
    }
  }

  console.log(`\n======================================================================`);
  console.log(`E2E NL -> Binary Results: ${passed} / ${TEST_CASES.length} Passed`);
  console.log(`Success Rate: ${((passed / TEST_CASES.length) * 100).toFixed(1)}%`);
  console.log(`======================================================================\n`);

  if (passed !== TEST_CASES.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal in runExportE2E:', err);
  process.exit(1);
});
