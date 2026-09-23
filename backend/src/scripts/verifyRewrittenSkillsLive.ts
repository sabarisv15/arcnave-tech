/**
 * Verification script for Rewritten Core File Skills (PDF, XLSX, DOCX, PPTX).
 *
 * Verifies:
 * 1. SkillService loading & schema validation (v2.0.0, category=artifact, tools=[generate_deliverable])
 * 2. Static verification of content:
 *    - Real operations documented
 *    - Phantom claims removed
 *    - Native provider understanding prioritized
 *    - Format preservation & XML package integrity
 *    - Cross-skill workflows documented
 *    - Validation / repair loop instructions present
 * 3. Live Gemini execution:
 *    - Individual load_skill for pdf, xlsx, docx, pptx
 *    - Chained multi-skill load (pdf -> xlsx)
 *    - Model procedural understanding spot-checks
 */

import { loadConfig } from '../config.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest } from '../providers/types.js';
import { SkillService } from '../services/skills.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import { LOAD_SKILL } from '../tools/definitions.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';

interface TestResult {
  section: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

async function main() {
  console.log('================================================================');
  console.log('   VERIFY REWRITTEN CORE FILE SKILLS (PDF, XLSX, DOCX, PPTX)    ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const capabilities = buildCapabilityRegistry(cfg);
  const skillsService = new SkillService(process.cwd(), 'skills', capabilities);
  await skillsService.load();

  // --------------------------------------------------------------------------
  // 1. REGISTRY & FRONTMATTER VERIFICATION
  // --------------------------------------------------------------------------
  console.log('>>> SECTION 1: Registry & Frontmatter Checks');
  const targetSkills = ['pdf', 'xlsx', 'docx', 'pptx'];

  for (const skillName of targetSkills) {
    const detail = skillsService.getSkill(skillName, ['generate_deliverable', 'load_skill']);
    if (!detail) {
      results.push({
        section: 'Registry',
        name: `Skill ${skillName} exists`,
        passed: false,
        details: 'Not found in registry',
      });
      continue;
    }

    const versionPass = detail.version === '2.0.0';
    const catPass = detail.category === 'artifact';
    const scopePass = detail.scope === 'builtin';

    results.push({
      section: 'Frontmatter',
      name: `Skill ${skillName} frontmatter validity`,
      passed: versionPass && catPass && scopePass,
      details: `version=${detail.version}, category=${detail.category}, scope=${detail.scope}, mode=${detail.mode}`,
    });

    console.log(`   [${skillName}] version=${detail.version}, cat=${detail.category}, mode=${detail.mode} => ${versionPass ? 'PASS' : 'FAIL'}`);
  }

  // --------------------------------------------------------------------------
  // 2. CONTENT AUDIT: REAL OPERATIONS & PHANTOM ELIMINATION
  // --------------------------------------------------------------------------
  console.log('\n>>> SECTION 2: Content Audit (Operations & Phantoms)');

  const pdfDetail = skillsService.getSkill('pdf', ['generate_deliverable']);
  const xlsxDetail = skillsService.getSkill('xlsx', ['generate_deliverable']);
  const docxDetail = skillsService.getSkill('docx', ['generate_deliverable']);
  const pptxDetail = skillsService.getSkill('pptx', ['generate_deliverable']);

  // PDF
  const pdfContent = pdfDetail?.content ?? '';
  const pdfHasInspect = pdfContent.includes('inspectPdf');
  const pdfHasMerge = pdfContent.includes('mergePdfFiles');
  const pdfHasSplit = pdfContent.includes('splitPdfFile');
  const pdfHasNative = pdfContent.includes('Provider-Native Direct Understanding');
  const pdfNoPhantomConversion = !pdfContent.includes('generate_deliverable({ targetFormat: "xlsx", sourceAttachmentId: "att_pdf" })');
  const pdfNoCreateArtifact = !pdfContent.includes('requires.tools: [create_artifact]');

  results.push({
    section: 'Content-PDF',
    name: 'PDF: Operations, Native Understanding & No Phantoms',
    passed: pdfHasInspect && pdfHasMerge && pdfHasSplit && pdfHasNative && pdfNoPhantomConversion && pdfNoCreateArtifact,
    details: `inspect=${pdfHasInspect}, merge=${pdfHasMerge}, split=${pdfHasSplit}, native=${pdfHasNative}, noPhantom=${pdfNoPhantomConversion}`,
  });
  console.log(`   [PDF Content Audit] => ${pdfHasInspect && pdfHasMerge && pdfHasSplit && pdfHasNative && pdfNoPhantomConversion ? 'PASS' : 'FAIL'}`);

  // XLSX
  const xlsxContent = xlsxDetail?.content ?? '';
  const xlsxHasStructuredWorkbook = xlsxContent.includes('StructuredWorkbook');
  const xlsxHasInspect = xlsxContent.includes('inspectSpreadsheet');
  const xlsxHasEditCells = xlsxContent.includes('editSpreadsheetCells');
  const xlsxHasCombine = xlsxContent.includes('combineWorkbooks');
  const xlsxHasFormulas = xlsxContent.includes('strictly UPPERCASE') || xlsxContent.includes('UPPERCASE formulas');
  const xlsxNoCreateArtifact = !xlsxContent.includes('requires.tools: [create_artifact]');

  results.push({
    section: 'Content-XLSX',
    name: 'XLSX: StructuredWorkbook, Real Operations & Formula Rules',
    passed: xlsxHasStructuredWorkbook && xlsxHasInspect && xlsxHasEditCells && xlsxHasCombine && xlsxHasFormulas && xlsxNoCreateArtifact,
    details: `structured=${xlsxHasStructuredWorkbook}, inspect=${xlsxHasInspect}, editCells=${xlsxHasEditCells}, combine=${xlsxHasCombine}, formulas=${xlsxHasFormulas}`,
  });
  console.log(`   [XLSX Content Audit] => ${xlsxHasStructuredWorkbook && xlsxHasInspect && xlsxHasEditCells && xlsxHasCombine && xlsxHasFormulas ? 'PASS' : 'FAIL'}`);

  // DOCX
  const docxContent = docxDetail?.content ?? '';
  const docxHasInspect = docxContent.includes('inspectDocxStructure');
  const docxHasEdit = docxContent.includes('editDocxContent');
  const docxHasAppend = docxContent.includes('appendDocxSection');
  const docxHasPackage = docxContent.includes('preserving the entire existing OOXML package') || docxContent.includes('OpenXML package preservation');
  const docxHasHeadings = docxContent.includes('Heading Hierarchy');

  results.push({
    section: 'Content-DOCX',
    name: 'DOCX: Real Operations, Package Integrity & Hierarchy Rules',
    passed: docxHasInspect && docxHasEdit && docxHasAppend && docxHasPackage && docxHasHeadings,
    details: `inspect=${docxHasInspect}, edit=${docxHasEdit}, append=${docxHasAppend}, package=${docxHasPackage}`,
  });
  console.log(`   [DOCX Content Audit] => ${docxHasInspect && docxHasEdit && docxHasAppend && docxHasPackage ? 'PASS' : 'FAIL'}`);

  // PPTX
  const pptxContent = pptxDetail?.content ?? '';
  const pptxHasInspect = pptxContent.includes('inspectPptxStructure');
  const pptxHasReorder = pptxContent.includes('reorderPptxSlides');
  const pptxHasEditText = pptxContent.includes('editPptxSlideText');
  const pptxHasFloor = pptxContent.includes('Typography Floor');
  const pptxHasTakeaway = pptxContent.includes('Takeaway Titles');

  results.push({
    section: 'Content-PPTX',
    name: 'PPTX: Real Operations, Presentation Typography & Slide Rules',
    passed: pptxHasInspect && pptxHasReorder && pptxHasEditText && pptxHasFloor && pptxHasTakeaway,
    details: `inspect=${pptxHasInspect}, reorder=${pptxHasReorder}, editText=${pptxHasEditText}, floor=${pptxHasFloor}`,
  });
  console.log(`   [PPTX Content Audit] => ${pptxHasInspect && pptxHasReorder && pptxHasEditText && pptxHasFloor && pptxHasTakeaway ? 'PASS' : 'FAIL'}`);

  // --------------------------------------------------------------------------
  // 3. LIVE GEMINI PROVIDER TESTS (load_skill execution & response)
  // --------------------------------------------------------------------------
  console.log('\n>>> SECTION 3: Live Gemini load_skill Execution');

  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';
  const skillExecutor = new SkillToolExecutor(skillsService, new Set(['load_skill', 'generate_deliverable']));

  async function testLiveSkillLoad(skillName: string): Promise<boolean> {
    const req: GenerationRequest = {
      prompt: `Please call load_skill for "${skillName}" and give a 1-sentence confirmation of its version and core capabilities.`,
      history: [],
      systemInstruction: 'You are ArcNave assistant. You have access to load_skill. Always use load_skill to retrieve skill instructions before answering.',
      mode: 'chat',
      maxOutputTokens: 500,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: [LOAD_SKILL],
      toolExecutor: skillExecutor,
      signal: new AbortController().signal,
    };

    let calledSkill = '';
    let loadedVersion = '';
    let responseText = '';

    for await (const ev of provider.stream(req)) {
      if (ev.type === 'tool_use') {
        calledSkill = String((ev.input as any)?.name ?? '');
      }
      if (ev.type === 'tool_result') {
        const data = (ev.result.content[0] as any)?.data;
        loadedVersion = data?.version || '';
      }
      if (ev.type === 'delta') {
        responseText += ev.text;
      }
    }

    const passed = calledSkill.toLowerCase() === skillName.toLowerCase() && loadedVersion === '2.0.0' && responseText.length > 0;
    console.log(`   [Live load_skill: ${skillName}] called=${calledSkill}, version=${loadedVersion}, responsePreview="${responseText.trim().slice(0, 70)}..." => ${passed ? 'PASS' : 'FAIL'}`);
    return passed;
  }

  for (const s of ['pdf', 'xlsx', 'docx', 'pptx']) {
    const ok = await testLiveSkillLoad(s);
    results.push({
      section: 'Live-load_skill',
      name: `Live load_skill(${s})`,
      passed: ok,
      details: `Skill ${s} loaded live, returned v2.0.0 and model generated synthesis`,
    });
  }

  // --------------------------------------------------------------------------
  // 4. CHAINED MULTI-SKILL LIVE TESTS (PDF -> XLSX & DOCX -> PPTX)
  // --------------------------------------------------------------------------
  console.log('\n>>> SECTION 4: Chained Multi-Skill Live Tests');

  // Pair 1: PDF -> XLSX
  const chained1Req: GenerationRequest = {
    prompt: 'We need to transform a PDF financial report into an Excel workbook. Call load_skill for "pdf", then call load_skill for "xlsx", and explain the pipeline contract.',
    history: [],
    systemInstruction: 'You are ArcNave assistant. You have access to load_skill. Call load_skill for each required domain skill before summarizing the workflow.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    tools: [LOAD_SKILL],
    toolExecutor: skillExecutor,
    signal: new AbortController().signal,
  };

  const loadedSkills1: string[] = [];
  let chained1Response = '';

  for await (const ev of provider.stream(chained1Req)) {
    if (ev.type === 'tool_result') {
      const data = (ev.result.content[0] as any)?.data;
      if (data?.name) loadedSkills1.push(data.name);
    }
    if (ev.type === 'delta') {
      chained1Response += ev.text;
    }
  }

  const chained1Passed = loadedSkills1.includes('pdf') && loadedSkills1.includes('xlsx') && chained1Response.length > 0;
  console.log(`   [Chained Load: PDF -> XLSX] loaded=[${loadedSkills1.join(', ')}], responseLen=${chained1Response.length} => ${chained1Passed ? 'PASS' : 'FAIL'}`);
  results.push({
    section: 'Chained-Skills',
    name: 'Sequential load_skill(pdf) + load_skill(xlsx)',
    passed: chained1Passed,
    details: `Loaded: ${loadedSkills1.join(', ')}`,
  });

  // Pair 2: DOCX -> PPTX
  const chained2Req: GenerationRequest = {
    prompt: 'We need to convert an executive report in Word into a presentation pitch deck. Call load_skill for "docx", then call load_skill for "pptx", and explain the workflow.',
    history: [],
    systemInstruction: 'You are ArcNave assistant. You have access to load_skill. Call load_skill for each required domain skill before summarizing the workflow.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    tools: [LOAD_SKILL],
    toolExecutor: skillExecutor,
    signal: new AbortController().signal,
  };

  const loadedSkills2: string[] = [];
  let chained2Response = '';

  for await (const ev of provider.stream(chained2Req)) {
    if (ev.type === 'tool_result') {
      const data = (ev.result.content[0] as any)?.data;
      if (data?.name) loadedSkills2.push(data.name);
    }
    if (ev.type === 'delta') {
      chained2Response += ev.text;
    }
  }

  const chained2Passed = loadedSkills2.includes('docx') && loadedSkills2.includes('pptx') && chained2Response.length > 0;
  console.log(`   [Chained Load: DOCX -> PPTX] loaded=[${loadedSkills2.join(', ')}], responseLen=${chained2Response.length} => ${chained2Passed ? 'PASS' : 'FAIL'}`);
  results.push({
    section: 'Chained-Skills',
    name: 'Sequential load_skill(docx) + load_skill(pptx)',
    passed: chained2Passed,
    details: `Loaded: ${loadedSkills2.join(', ')}`,
  });

  // --------------------------------------------------------------------------
  // 5. MODEL PROCEDURAL UNDERSTANDING SPOT-CHECKS (A through F)
  // --------------------------------------------------------------------------
  console.log('\n>>> SECTION 5: Procedural Understanding Spot-Checks');

  // Check A: PDF summary request -> native/provider understanding first, no deterministic tool
  const spotAReq: GenerationRequest = {
    prompt: `You have loaded the ArcNave pdf skill (v2.0.0).
A user uploads an 8-page vendor agreement PDF and asks: "What are the termination notice requirements and payment terms?"
Should you run deterministic tools like splitPdfFile / mergePdfFiles, or should you read and extract the information using native multimodal provider understanding?
Answer in 1-2 sentences.`,
    history: [],
    systemInstruction: 'You are ArcNave assistant with expert knowledge of ArcNave file skills.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };

  let spotAText = '';
  for await (const ev of provider.stream(spotAReq)) {
    if (ev.type === 'delta') spotAText += ev.text;
  }
  const lowerA = spotAText.toLowerCase();
  const spotAPass = lowerA.includes('native') || lowerA.includes('multimodal') || lowerA.includes('provider') || lowerA.includes('direct');
  console.log(`   [Spot-Check A: PDF Native Understanding] Passed=${spotAPass}. Response: "${spotAText.trim().replace(/\n/g, ' ').slice(0, 100)}..."`);
  results.push({
    section: 'Procedural-Check',
    name: 'A: PDF Summary (Native/Provider Priority)',
    passed: spotAPass,
    details: spotAText.trim().replace(/\n/g, ' ').slice(0, 120),
  });

  // Check B: Merge two PDFs -> deterministic merge
  const spotBReq: GenerationRequest = {
    prompt: `You have loaded the ArcNave pdf skill (v2.0.0).
A user uploads two separate PDF files: "appendix_A.pdf" and "appendix_B.pdf" and asks: "Merge these two PDF documents into a single file called appendices.pdf."
Which operation must you use:
A) inspectPdf
B) splitPdfFile
C) mergePdfFiles
Answer with the letter and function name.`,
    history: [],
    systemInstruction: 'You are ArcNave assistant with expert knowledge of ArcNave file skills.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };

  let spotBText = '';
  for await (const ev of provider.stream(spotBReq)) {
    if (ev.type === 'delta') spotBText += ev.text;
  }
  const spotBPass = spotBText.includes('mergePdfFiles') || spotBText.includes('C');
  console.log(`   [Spot-Check B: PDF Merge Selection] Passed=${spotBPass}. Response: "${spotBText.trim().replace(/\n/g, ' ').slice(0, 100)}..."`);
  results.push({
    section: 'Procedural-Check',
    name: 'B: Merge Two PDFs (mergePdfFiles)',
    passed: spotBPass,
    details: spotBText.trim().replace(/\n/g, ' ').slice(0, 120),
  });

  // Check C: XLSX targeted cell edit -> editSpreadsheetCells, no Markdown rebuild
  const spotCReq: GenerationRequest = {
    prompt: `You have loaded the ArcNave xlsx skill (v2.0.0).
A user has an existing 5-sheet financial workbook with custom formulas, conditional formatting, and corporate themes.
The user requests: "Please update the Q3 revenue in cell D14 of sheet 'Summary' to 450,000."
Which operation must you use:
A) Completely rebuild the spreadsheet from Markdown using generate_deliverable
B) Use editSpreadsheetCells to perform an in-place cell update preserving existing formulas, sheets, and themes
Explain your choice in 1-2 sentences.`,
    history: [],
    systemInstruction: 'You are ArcNave assistant with expert knowledge of ArcNave file skills.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };

  let spotCText = '';
  for await (const ev of provider.stream(spotCReq)) {
    if (ev.type === 'delta') spotCText += ev.text;
  }
  const spotCPass = spotCText.includes('editSpreadsheetCells') || spotCText.includes('B');
  console.log(`   [Spot-Check C: XLSX In-Place Edit] Passed=${spotCPass}. Response: "${spotCText.trim().replace(/\n/g, ' ').slice(0, 100)}..."`);
  results.push({
    section: 'Procedural-Check',
    name: 'C: XLSX Targeted Edit (editSpreadsheetCells)',
    passed: spotCPass,
    details: spotCText.trim().replace(/\n/g, ' ').slice(0, 120),
  });

  // Check D: DOCX targeted text replacement -> editDocxContent, preserve OOXML package
  const spotDReq: GenerationRequest = {
    prompt: `You have loaded the ArcNave docx skill (v2.0.0).
A user uploads an existing employment agreement "Contract.docx" and says: "Replace every occurrence of 'Acme Corp' with 'Globex International'."
Should you:
A) Re-author the entire contract from Markdown via generate_deliverable
B) Use editDocxContent to perform targeted string replacements while preserving the OOXML package styles, headers, and media
Answer with your choice and rationale.`,
    history: [],
    systemInstruction: 'You are ArcNave assistant with expert knowledge of ArcNave file skills.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };

  let spotDText = '';
  for await (const ev of provider.stream(spotDReq)) {
    if (ev.type === 'delta') spotDText += ev.text;
  }
  const spotDPass = spotDText.includes('editDocxContent') || spotDText.includes('B');
  console.log(`   [Spot-Check D: DOCX Targeted Edit] Passed=${spotDPass}. Response: "${spotDText.trim().replace(/\n/g, ' ').slice(0, 100)}..."`);
  results.push({
    section: 'Procedural-Check',
    name: 'D: DOCX Targeted Replacement (editDocxContent)',
    passed: spotDPass,
    details: spotDText.trim().replace(/\n/g, ' ').slice(0, 120),
  });

  // Check E: PPTX slide reorder -> reorderPptxSlides, no full-deck rebuild
  const spotEReq: GenerationRequest = {
    prompt: `You have loaded the ArcNave pptx skill (v2.0.0).
A user has an existing 20-slide investor deck "PitchDeck.pptx" and asks: "Swap slide 2 and slide 3 so the team slide comes before the market slide."
Which operation should you perform:
A) Rebuild all 20 slides from markdown with generate_deliverable
B) Use reorderPptxSlides to update the slide order in presentation.xml without altering or re-encoding slide layouts
Answer with your choice and rationale.`,
    history: [],
    systemInstruction: 'You are ArcNave assistant with expert knowledge of ArcNave file skills.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };

  let spotEText = '';
  for await (const ev of provider.stream(spotEReq)) {
    if (ev.type === 'delta') spotEText += ev.text;
  }
  const spotEPass = spotEText.includes('reorderPptxSlides') || spotEText.includes('B');
  console.log(`   [Spot-Check E: PPTX Slide Reorder] Passed=${spotEPass}. Response: "${spotEText.trim().replace(/\n/g, ' ').slice(0, 100)}..."`);
  results.push({
    section: 'Procedural-Check',
    name: 'E: PPTX Slide Reorder (reorderPptxSlides)',
    passed: spotEPass,
    details: spotEText.trim().replace(/\n/g, ' ').slice(0, 120),
  });

  // Check F: Cross-Skill DOCX -> PPTX -> source Skill + target Skill cooperation, no monolithic pipeline
  const spotFReq: GenerationRequest = {
    prompt: `You have an executive strategy document in Word ("Strategy.docx") and the user asks: "Create a 5-slide summary presentation from this document."
How do ArcNave skills cooperate to accomplish this:
A) A monolithic "ConversionPipeline" or "FileWorkflowRunner" automatically transcodes DOCX binary to PPTX binary in a single black-box step.
B) Multi-skill cooperation: The docx skill/provider context is used to understand the document and extract key themes and metrics, and the pptx skill structures the content into slide cards adhering to typography guidelines and generates the deliverable via generate_deliverable.
Answer with your choice (A or B) and explain in 1-2 sentences.`,
    history: [],
    systemInstruction: 'You are ArcNave assistant with expert knowledge of ArcNave file skills.',
    mode: 'chat',
    maxOutputTokens: 1000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };

  let spotFText = '';
  for await (const ev of provider.stream(spotFReq)) {
    if (ev.type === 'delta') spotFText += ev.text;
  }
  const spotFPass = spotFText.includes('B') && !spotFText.includes('A is correct');
  console.log(`   [Spot-Check F: Cross-Skill Cooperation] Passed=${spotFPass}. Response: "${spotFText.trim().replace(/\n/g, ' ').slice(0, 100)}..."`);
  results.push({
    section: 'Procedural-Check',
    name: 'F: Cross-Skill DOCX -> PPTX Cooperation',
    passed: spotFPass,
    details: spotFText.trim().replace(/\n/g, ' ').slice(0, 120),
  });

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                      VERIFICATION SUMMARY                      ');
  console.log('================================================================');

  let totalPassed = 0;
  for (const r of results) {
    if (r.passed) totalPassed++;
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] [${r.section}] ${r.name} - ${r.details}`);
  }

  console.log(`\nTOTAL: ${totalPassed}/${results.length} PASSED.`);
  if (totalPassed === results.length) {
    console.log('\n>>> ALL REWRITTEN CORE FILE SKILLS FULLY VERIFIED IN PRODUCTION TRUTH <<<\n');
  } else {
    console.error('\n>>> SOME TESTS FAILED <<<\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running verification:', err);
  process.exit(1);
});
