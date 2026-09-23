import { describe, expect, it } from 'vitest';
import { routeTurn } from './turnRouter.js';

const candidateSkills = [
  { name: 'docx', description: 'Professional Word document authoring' },
  { name: 'pdf', description: 'Print-ready PDF report architecture' },
  { name: 'pptx', description: '16:9 presentation deck design' },
  { name: 'xlsx', description: 'Professional spreadsheet architecture' },
];

describe('routeTurn — Hard Policy Filter & Model-Driven Tool Gating', () => {
  it('A: "generate a clock image" -> IMAGE_GENERATION, allowedTools contains generate_image', () => {
    const decision = routeTurn({
      prompt: 'generate a clock image',
      mode: 'chat',
      hasAttachments: false,
      candidateSkills,
      hasProject: false,
      imageEnabled: true,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('IMAGE_GENERATION');
    expect(decision.selectedSkills).toEqual([]);
    expect(decision.allowedTools).toContain('generate_image');
    expect(decision.exposedTools).toEqual(['search_tools']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('B: "convert this PDF into Excel" -> FILE_CONVERSION, tools in allowed catalog, no blanket auto-exposure', () => {
    const decision = routeTurn({
      prompt: 'convert this PDF into Excel',
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['application/pdf'],
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('FILE_CONVERSION');
    // Model progressively loads skills via load_skill, not regex pre-selected
    expect(decision.selectedSkills).toEqual([]);
    // Deliverable tools in policy catalog
    expect(decision.allowedTools).toContain('generate_deliverable');
    expect(decision.allowedTools).toContain('read_uploaded_file');
    expect(decision.allowedTools).toContain('search_tools');
    // Model evaluates first, discovers tools on demand
    expect(decision.exposedTools).toEqual(['search_tools']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('B2: Upload PDF + "convert into excel file" -> FILE_CONVERSION, model-driven gating', () => {
    const decision = routeTurn({
      prompt: 'convert into excel file',
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['application/pdf'],
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('FILE_CONVERSION');
    expect(decision.selectedSkills).toEqual([]);
    expect(decision.allowedTools).toContain('generate_deliverable');
    expect(decision.allowedTools).toContain('read_uploaded_file');
    expect(decision.exposedTools).toEqual(['search_tools']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('C: "convert this PDF into Word" -> FILE_CONVERSION, model-driven gating', () => {
    const decision = routeTurn({
      prompt: 'convert this PDF into Word',
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['application/pdf'],
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('FILE_CONVERSION');
    expect(decision.selectedSkills).toEqual([]);
    expect(decision.allowedTools).toContain('generate_deliverable');
    expect(decision.exposedTools).toEqual(['search_tools']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('D: "make a PowerPoint from this PDF" -> FILE_CONVERSION, model-driven gating', () => {
    const decision = routeTurn({
      prompt: 'make a PowerPoint from this PDF',
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['application/pdf'],
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('FILE_CONVERSION');
    expect(decision.selectedSkills).toEqual([]);
    expect(decision.allowedTools).toContain('generate_deliverable');
    expect(decision.exposedTools).toEqual(['search_tools']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('E: "explain Monte Carlo simulation" -> EXPLANATION, no skills, no tools, no Python', () => {
    const decision = routeTurn({
      prompt: 'explain Monte Carlo simulation',
      mode: 'chat',
      hasAttachments: false,
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('EXPLANATION');
    expect(decision.selectedSkills).toEqual([]);
    expect(decision.exposedTools).toEqual([]);
    expect(decision.pythonExposed).toBe(false);
  });

  it('Ordinary chat -> ORDINARY_CHAT, no skills, no tools, no Python', () => {
    const decision = routeTurn({
      prompt: 'Hi there, how are you today?',
      mode: 'chat',
      hasAttachments: false,
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('ORDINARY_CHAT');
    expect(decision.selectedSkills).toEqual([]);
    expect(decision.exposedTools).toEqual([]);
    expect(decision.pythonExposed).toBe(false);
  });

  it('Computation request -> COMPUTATION, exposes run_python in catalog and exposedTools', () => {
    const decision = routeTurn({
      prompt: 'Run a Monte Carlo simulation with 10,000 trials to calculate option price',
      mode: 'chat',
      hasAttachments: false,
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('COMPUTATION');
    expect(decision.allowedTools).toContain('run_python');
    expect(decision.exposedTools).toEqual(['search_tools']);
    expect(decision.pythonExposed).toBe(true);
  });

  it('Hard Policy Gating strictly excludes unauthorized capabilities from allowedTools', () => {
    const restricted = routeTurn({
      prompt: 'Run a calculation and generate an image',
      mode: 'chat',
      hasAttachments: false,
      candidateSkills: [],
      hasProject: false,
      imageEnabled: false,
      runPythonEnabled: false,
    });

    expect(restricted.allowedTools).not.toContain('run_python');
    expect(restricted.allowedTools).not.toContain('generate_image');
    expect(restricted.allowedTools).not.toContain('search_project_files');
    expect(restricted.allowedTools).not.toContain('read_uploaded_file');
    expect(restricted.pythonExposed).toBe(false);
  });
});
