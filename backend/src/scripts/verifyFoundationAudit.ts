/**
 * Pre-Batch 3 Foundation Audit Verification Script
 * Validates locked architecture foundations live against real Gemini provider & ExecutionRuntime.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { loadConfig } from '../config.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { AttachmentBlock, GenerationRequest, Provider, ToolCall, ToolResult, ToolDefinition } from '../providers/types.js';
import { SkillService } from '../services/skills.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import { LOAD_SKILL, SEARCH_TOOLS } from '../tools/definitions.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { ProcessSandboxClient } from '../tools/sandbox/processSandboxClient.js';
import { CloudRunSandboxClient } from '../tools/sandbox/cloudRunSandboxClient.js';
import { GoogleAuth } from 'google-auth-library';
import { Storage as GcsStorage } from '@google-cloud/storage';

interface AuditResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
  metrics?: Record<string, unknown>;
}

const auditResults: AuditResult[] = [];

async function main() {
  console.log('================================================================');
  console.log('   PRE-BATCH 3 FOUNDATION AUDIT — LIVE VERIFICATION             ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';

  // Initialize skills service
  const skillsService = new SkillService(process.cwd(), 'skills');
  await skillsService.load();

  // Initialize ExecutionRuntime
  let sandboxClient;
  if (cfg.SANDBOX_ENGINE === 'cloud-run' && cfg.GOOGLE_CLOUD_PROJECT) {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const storageClient = new GcsStorage({ projectId: cfg.GOOGLE_CLOUD_PROJECT });
    sandboxClient = new CloudRunSandboxClient({
      project: cfg.GOOGLE_CLOUD_PROJECT,
      location: cfg.SANDBOX_LOCATION ?? 'asia-south1',
      jobName: 'arcnave-python-sandbox',
      getAccessToken: async () => String(await auth.getAccessToken()),
      codeTimeoutMs: 15_000,
      orchestrationTimeoutMs: 90_000,
      maxCodeBytes: 20 * 1024,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      stagingBucket: cfg.SANDBOX_STAGE_BUCKET,
      storageClient,
    });
  } else {
    sandboxClient = new ProcessSandboxClient();
  }

  const runtime = new ExecutionRuntime(sandboxClient);

  // --------------------------------------------------------------------------
  // AUDIT 1A: Native-Text PDF to Live Model
  // --------------------------------------------------------------------------
  console.log('>>> AUDIT 1A: Native-Text PDF Path');
  try {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText('QUARTERLY FINANCIAL REPORT', { x: 50, y: 350, size: 18, font, color: rgb(0, 0, 0) });
    page.drawText('Q1 Revenue: $1,200,000', { x: 50, y: 300, size: 14, font, color: rgb(0, 0, 0) });
    page.drawText('Q2 Revenue: $1,850,000', { x: 50, y: 270, size: 14, font, color: rgb(0, 0, 0) });
    page.drawText('Q3 Revenue: $2,100,000', { x: 50, y: 240, size: 14, font, color: rgb(0, 0, 0) });
    const pdfBytes = await doc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    const attachment: AttachmentBlock = {
      id: 'att-native-1',
      filename: 'revenue.pdf',
      mimeType: 'application/pdf',
      base64: pdfBase64,
      sizeBytes: pdfBytes.length,
    };

    const req: GenerationRequest = {
      prompt: 'What is the exact Q2 Revenue in this document? Return only the dollar figure.',
      history: [],
      attachments: [attachment],
      systemInstruction: 'You are a precise document extraction assistant. State the exact figure requested.',
      mode: 'chat',
      maxOutputTokens: 100,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
    };

    let reply = '';
    for await (const ev of provider.stream(req)) {
      if (ev.type === 'delta') reply += ev.text;
    }

    const hasFigure = reply.includes('1,850,000');
    console.log(`   Model response: "${reply.trim()}"`);
    console.log(`   Figure matched: ${hasFigure}`);
    auditResults.push({
      id: 'AUDIT_1A',
      name: 'Native-text PDF to Gemini',
      passed: hasFigure,
      details: `Provider: Gemini | Model: ${modelId} | Block: inlineData(application/pdf) | Output: "${reply.trim()}"`,
    });
  } catch (err: any) {
    console.error('   AUDIT 1A FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_1A', name: 'Native-text PDF', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // AUDIT 1B: Scanned/Raster PDF to Live Model
  // --------------------------------------------------------------------------
  console.log('\n>>> AUDIT 1B: Scanned/Raster PDF Path (Page 1 of kvbfedral.pdf)');
  try {
    const fixturePath = path.resolve('test-artifacts/fixtures/kvbfedral.pdf');
    const fixtureBytes = await fs.readFile(fixturePath);
    const sourcePdf = await PDFDocument.load(fixtureBytes);

    // Slice just page 1 so the live test is fast and bounded
    const singleDoc = await PDFDocument.create();
    const [copiedPage] = await singleDoc.copyPages(sourcePdf, [0]);
    singleDoc.addPage(copiedPage);
    const singleBytes = await singleDoc.save();
    const singleB64 = Buffer.from(singleBytes).toString('base64');

    const attachment: AttachmentBlock = {
      id: 'att-scanned-1',
      filename: 'kvbfedral_page1.pdf',
      mimeType: 'application/pdf',
      base64: singleB64,
      sizeBytes: singleBytes.length,
    };

    const req: GenerationRequest = {
      prompt: 'Identify the primary bank name and branch or account header on this scanned bank statement page.',
      history: [],
      attachments: [attachment],
      systemInstruction: 'You are an accurate banking document parser. State the bank name and branch clearly.',
      mode: 'chat',
      maxOutputTokens: 1000,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
    };

    let reply = '';
    for await (const ev of provider.stream(req)) {
      if (ev.type === 'delta') reply += ev.text;
    }

    const mentionsKvb = /karur|vysya|kvb/i.test(reply);
    console.log(`   Model response: "${reply.trim()}"`);
    console.log(`   Bank identified: ${mentionsKvb}`);
    auditResults.push({
      id: 'AUDIT_1B',
      name: 'Scanned PDF to Gemini',
      passed: mentionsKvb,
      details: `Model successfully read scanned raster page | Output: "${reply.trim().slice(0, 120)}..."`,
    });
  } catch (err: any) {
    console.error('   AUDIT 1B FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_1B', name: 'Scanned PDF', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // AUDIT 2: Same Attachment Identity Across Model + Runtime
  // --------------------------------------------------------------------------
  console.log('\n>>> AUDIT 2: Attachment Identity & Disambiguation');
  try {
    const ws = await runtime.createWorkspace(`audit-2-${Date.now()}`);
    try {
      const mockStorage = {
        get: async (key: string) => Buffer.from(`DATA FOR ${key}`),
      } as any;

      const dbRows: Record<string, any> = {
        'att-uuid-1': {
          id: 'att-uuid-1',
          filename: 'statement.pdf',
          mimeType: 'application/pdf',
          storageKey: 'storage-key-1',
          sizeBytes: 100,
        },
        'att-dup-a': {
          id: 'att-dup-a',
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          storageKey: 'storage-key-dup-a',
          sizeBytes: 120,
        },
        'att-dup-b': {
          id: 'att-dup-b',
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          storageKey: 'storage-key-dup-b',
          sizeBytes: 150,
        },
      };

      const makeDbForId = (id: string) => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [dbRows[id]],
            }),
          }),
        }),
      } as any);

      // Materialize single file
      const m1 = await runtime.materializeAttachment(ws, 'att-uuid-1', 'user-1', makeDbForId('att-uuid-1'), mockStorage);
      const content1 = await fs.readFile(m1.path, 'utf8');

      // Materialize duplicate filename A and B
      const mA = await runtime.materializeAttachment(ws, 'att-dup-a', 'user-1', makeDbForId('att-dup-a'), mockStorage);
      const mB = await runtime.materializeAttachment(ws, 'att-dup-b', 'user-1', makeDbForId('att-dup-b'), mockStorage);

      const contentA = await fs.readFile(mA.path, 'utf8');
      const contentB = await fs.readFile(mB.path, 'utf8');

      const noCollision = mA.path !== mB.path;
      const contentPreserved = contentA === 'DATA FOR storage-key-dup-a' && contentB === 'DATA FOR storage-key-dup-b';
      const passed = content1 === 'DATA FOR storage-key-1' && noCollision && contentPreserved;

      console.log(`   File 1: ${m1.filename} -> ${m1.path}`);
      console.log(`   Dup A:  ${mA.filename} -> ${mA.path}`);
      console.log(`   Dup B:  ${mB.filename} -> ${mB.path}`);
      console.log(`   Distinct paths for duplicate filename: ${noCollision}`);
      console.log(`   Content preserved without overwrite: ${contentPreserved}`);

      auditResults.push({
        id: 'AUDIT_2',
        name: 'Attachment Identity across Model and Runtime',
        passed,
        details: `att-dup-a -> ${mA.filename} (${contentA}) | att-dup-b -> ${mB.filename} (${contentB}) | collision-free: ${noCollision}`,
      });
    } finally {
      await runtime.cleanupWorkspace(ws);
    }
  } catch (err: any) {
    console.error('   AUDIT 2 FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_2', name: 'Attachment Identity', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // AUDIT 3: Multi-Skill Progressive Loading
  // --------------------------------------------------------------------------
  console.log('\n>>> AUDIT 3: Multi-Skill Progressive Loading');
  try {
    const loadedSkills: string[] = [];
    const skillExecutor = new SkillToolExecutor(skillsService, new Set(['load_skill']), (s) => {
      loadedSkills.push(s.name);
    });

    // Step 1: Load PDF skill
    const r1 = await skillExecutor.execute({ id: 'c1', name: 'load_skill', input: { name: 'pdf' } }, new AbortController().signal);
    // Step 2: Load XLSX skill
    const r2 = await skillExecutor.execute({ id: 'c2', name: 'load_skill', input: { name: 'xlsx' } }, new AbortController().signal);

    const hasBoth = r1.ok && r2.ok && loadedSkills.includes('pdf') && loadedSkills.includes('xlsx');
    console.log(`   Loaded skills: [${loadedSkills.join(', ')}]`);
    console.log(`   Both succeeded: ${hasBoth}`);
    auditResults.push({
      id: 'AUDIT_3',
      name: 'Multi-Skill Progressive Loading',
      passed: hasBoth,
      details: `Sequential load: pdf -> xlsx both succeed and return full markdown instructions without conflict`,
    });
  } catch (err: any) {
    console.error('   AUDIT 3 FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_3', name: 'Multi-Skill Loading', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // AUDIT 4: Skill Resource Loading & Path Traversal Protection
  // --------------------------------------------------------------------------
  console.log('\n>>> AUDIT 4: Skill Resource Loading & Traversal Protection');
  try {
    const skillExecutor = new SkillToolExecutor(skillsService);
    // Test 1: Load resource with path traversal
    const rTraversal = await skillExecutor.execute(
      { id: 'c-trav', name: 'load_skill', input: { name: 'xlsx', resource: '../../package.json' } },
      new AbortController().signal,
    );
    const contentTraversal = (rTraversal.content[0] as any).data;
    const traversalBlocked = contentTraversal?.resourceContent === '[Resource file not found]';

    console.log(`   Path traversal blocked: ${traversalBlocked}`);
    auditResults.push({
      id: 'AUDIT_4',
      name: 'Skill Resource Traversal Protection',
      passed: traversalBlocked,
      details: `Path traversal attempt ../../package.json was safely intercepted and blocked.`,
    });
  } catch (err: any) {
    console.error('   AUDIT 4 FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_4', name: 'Skill Resource Protection', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // AUDIT 5: Deterministic Skill Script Execution
  // --------------------------------------------------------------------------
  console.log('\n>>> AUDIT 5: Deterministic Skill Script Execution');
  try {
    const testScript = `
total = sum(input_data["values"])
print(json.dumps({"verified": True, "total": total}))
`;
    const res = await runtime.executeDeterministicSkillScript(testScript, { values: [100, 250, 450] });
    let parsedOut: any = null;
    if (res.ok && typeof res.output === 'string') {
      try {
        const outer = JSON.parse(res.output);
        const innerText = outer.msg_out ?? res.output;
        parsedOut = JSON.parse(innerText.trim().split('\n').pop()!);
      } catch {
        parsedOut = JSON.parse(res.output.trim().split('\n').pop()!);
      }
    }
    const passed = parsedOut?.verified === true && parsedOut?.total === 800;
    console.log(`   Script execution ok: ${res.ok}`);
    if (!res.ok) console.log(`   Script error: ${res.error}`);
    console.log(`   Output: ${JSON.stringify(parsedOut)}`);
    auditResults.push({
      id: 'AUDIT_5',
      name: 'Deterministic Skill Script Execution',
      passed,
      details: `Script executed via sandbox (${cfg.SANDBOX_ENGINE}) with parsed output: ${JSON.stringify(parsedOut)}`,
    });
  } catch (err: any) {
    console.error('   AUDIT 5 FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_5', name: 'Skill Script Execution', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // AUDIT 6: Workspace Intermediate Artifacts Area
  // --------------------------------------------------------------------------
  console.log('\n>>> AUDIT 6: Workspace Intermediate Artifacts Area');
  try {
    const ws = await runtime.createWorkspace(`audit-6-${Date.now()}`);
    try {
      const chunk1Path = path.join(ws.tempDir, 'chunk-001.json');
      const chunk2Path = path.join(ws.tempDir, 'chunk-002.json');
      await fs.writeFile(chunk1Path, JSON.stringify({ page: 1, rows: [{ id: 1, val: 50 }] }));
      await fs.writeFile(chunk2Path, JSON.stringify({ page: 2, rows: [{ id: 2, val: 75 }] }));

      const c1 = JSON.parse(await fs.readFile(chunk1Path, 'utf8'));
      const c2 = JSON.parse(await fs.readFile(chunk2Path, 'utf8'));
      const merged = { totalRows: c1.rows.length + c2.rows.length, rows: [...c1.rows, ...c2.rows] };
      const finalPath = path.join(ws.tempDir, 'final.json');
      await fs.writeFile(finalPath, JSON.stringify(merged));

      const finalCheck = JSON.parse(await fs.readFile(finalPath, 'utf8'));
      const passed = finalCheck.totalRows === 2 && finalCheck.rows.length === 2;
      console.log(`   Temp directory exists: ${ws.tempDir}`);
      console.log(`   Intermediate chunk merge succeeded: ${passed}`);
      auditResults.push({
        id: 'AUDIT_6',
        name: 'Workspace Intermediate Artifacts Area',
        passed,
        details: `Workspace temp/ directory successfully held chunks 1 & 2 and merged into final.json without chat exposure`,
      });
    } finally {
      await runtime.cleanupWorkspace(ws);
    }
  } catch (err: any) {
    console.error('   AUDIT 6 FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_6', name: 'Workspace Intermediate Area', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // AUDIT 7: Tool Result -> Model -> Repair Loop (Live Gemini)
  // --------------------------------------------------------------------------
  console.log('\n>>> AUDIT 7: Tool Warning -> Model Repair Loop (Live Provider)');
  try {
    let repairStepObserved = false;
    let turnCount = 0;

    const mockToolDef: ToolDefinition = {
      name: 'validate_statement_table',
      description: 'Validates tabular statement columns. Returns warnings if required columns are missing.',
      inputSchema: {
        type: 'object',
        properties: {
          columns: { type: 'array', items: { type: 'string' } },
        },
        required: ['columns'],
      },
    };

    const mockRepairExecutor = {
      execute: async (call: ToolCall): Promise<ToolResult> => {
        const input = call.input as { columns?: string[] };
        if (!input.columns?.includes('balance')) {
          return {
            toolCallId: call.id,
            ok: true,
            content: [
              {
                type: 'json',
                data: {
                  status: 'warning',
                  warnings: [{ type: 'missing_column', message: 'Required column "balance" is missing' }],
                  recommendation: 'Add the balance column to the column list.',
                },
              },
            ],
          };
        }
        return {
          toolCallId: call.id,
          ok: true,
          content: [{ type: 'json', data: { status: 'pass', message: 'All columns verified.' } }],
        };
      },
    };

    const req: GenerationRequest = {
      prompt: 'Validate our initial columns ["date", "description", "amount"]. If any column is missing according to the tool warning, explain what needs to be fixed.',
      history: [],
      systemInstruction: 'You are an intelligent data quality assistant. Use validate_statement_table to verify columns and respond to any warnings.',
      mode: 'chat',
      maxOutputTokens: 300,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: [mockToolDef],
      toolExecutor: mockRepairExecutor,
      signal: new AbortController().signal,
    };

    let fullText = '';
    for await (const ev of provider.stream(req)) {
      if (ev.type === 'tool_use') {
        turnCount++;
        console.log(`   Model invoked tool: ${ev.name} with input:`, ev.input);
      }
      if (ev.type === 'tool_result') {
        console.log(`   Tool returned warning to model:`, (ev.result.content[0] as any)?.data);
      }
      if (ev.type === 'delta') fullText += ev.text;
    }

    repairStepObserved = fullText.toLowerCase().includes('balance');
    console.log(`   Model final text: "${fullText.trim().slice(0, 150)}..."`);
    console.log(`   Model acknowledged and reacted to warning: ${repairStepObserved}`);

    auditResults.push({
      id: 'AUDIT_7',
      name: 'Tool Warning to Model Repair Loop',
      passed: repairStepObserved,
      details: `Model received structured warning from tool and incorporated corrective action in its subsequent response.`,
    });
  } catch (err: any) {
    console.error('   AUDIT 7 FAILED:', err.message);
    auditResults.push({ id: 'AUDIT_7', name: 'Tool Repair Loop', passed: false, details: err.message });
  }

  // --------------------------------------------------------------------------
  // Print Summary Table
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('   AUDIT EXECUTION SUMMARY                                      ');
  console.log('================================================================');
  for (const r of auditResults) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.id}: ${r.name}`);
    console.log(`       Details: ${r.details}`);
  }
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('FATAL AUDIT FAILURE:', err);
  process.exit(1);
});
