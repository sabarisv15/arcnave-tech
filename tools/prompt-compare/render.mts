// Renders the system prompt and tool declarations ArcNave sends on a full turn (tools, memory,
// visuals, web, sandbox and skills all on), so the comparison reads what the model receives,
// not the source files. Run from backend/: npx tsx ../tools/prompt-compare/render.mts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, '..', '..', 'backend');
const work = join(here, 'work');
mkdirSync(work, { recursive: true });

const { InMemoryCapabilityRegistry } = await import(join(backend, 'src/capabilities/registry.ts'));
const { buildDynamicRuntimeContext, currentDateLine } = await import(join(backend, 'src/services/systemPrompt.ts'));
const { assemblePrompt } = await import(join(backend, 'src/services/promptCache/promptAssembly.ts'));
const D = await import(join(backend, 'src/tools/definitions.ts'));
const { SkillService } = await import(join(backend, 'src/services/skills.ts'));

const caps = new InMemoryCapabilityRegistry();
for (const id of ['python.execute', 'skills.discover', 'web.search', 'web.fetch']) caps.register({ id, status: 'full' });
const cfg = { ENABLE_TOOL_USE: true, SANDBOX_ENGINE: 'service', SANDBOX_URL: 'x' };
const tools = [
  ...D.QUESTION_TOOL_DEFINITIONS, ...D.MEMORY_TOOL_DEFINITIONS, ...D.CHAT_TOOL_DEFINITIONS,
  ...D.UI_TOOL_DEFINITIONS, ...D.WEB_TOOL_DEFINITIONS, ...D.codeToolDefinitions(true),
];
const names = tools.map((t: { name: string }) => t.name);

const skills = new SkillService(backend, 'skills', caps);
await skills.load();
const listed = skills.listSkills(new Set(names)).filter((s: { missingTools: string[] }) => s.missingTools.length === 0);
const availableSkills =
  '<available_skills>\n' +
  listed
    .map((s: { name: string; description: string }) =>
      `<skill>\n<name>${s.name}</name>\n<description>${s.description}</description>\n<location>/skills/${s.name}/SKILL.md</location>\n</skill>`)
    .join('\n') +
  '\n</available_skills>';

const assembly = assemblePrompt(tools, {
  currentDate: currentDateLine(new Date('2026-09-28T12:00:00Z'), 'Asia/Kolkata'),
  runtimeCapabilities: buildDynamicRuntimeContext(cfg, caps, names, false, names),
  skillsContext: availableSkills,
}, names);

writeFileSync(join(work, 'arcnave-system.txt'), assembly.fullSystemInstruction);
writeFileSync(join(work, 'arcnave-tools.json'), JSON.stringify([...tools, ...D.PROJECT_TOOL_DEFINITIONS], null, 1));
console.log(`system prompt ${assembly.fullSystemInstruction.length} chars, ${tools.length} tools`);
