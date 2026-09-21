import { describe, expect, it } from 'vitest';
import { routeTurn } from './turnRouter.js';

const candidateSkills = [
  { name: 'docx', description: 'Professional Word document authoring' },
  { name: 'pdf', description: 'Print-ready PDF report architecture' },
  { name: 'pptx', description: '16:9 presentation deck design' },
  { name: 'xlsx', description: 'Professional spreadsheet architecture' },
];

describe('routeTurn — Skill-first -> Tool-second routing', () => {
  it('A: "generate a clock image" -> IMAGE_GENERATION, no skills, generate_image only, no Python', () => {
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
    expect(decision.exposedTools).toEqual(['generate_image']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('B: "convert this PDF into Excel" -> FILE_CONVERSION, skills [pdf, xlsx], read_uploaded_file + generate_deliverable, no Python', () => {
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
    expect(decision.selectedSkills).toEqual(['pdf', 'xlsx']);
    expect(decision.exposedTools).toEqual(['read_uploaded_file', 'generate_deliverable']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('B2: Upload PDF + "convert into excel file" -> FILE_CONVERSION, skills [pdf, xlsx], read_uploaded_file + generate_deliverable, no Python', () => {
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
    expect(decision.selectedSkills).toEqual(['pdf', 'xlsx']);
    expect(decision.exposedTools).toEqual(['read_uploaded_file', 'generate_deliverable']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('C: "convert this PDF into Word" -> FILE_CONVERSION, skills [pdf, docx], read_uploaded_file + generate_deliverable, no Python', () => {
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
    expect(decision.selectedSkills).toEqual(['pdf', 'docx']);
    expect(decision.exposedTools).toEqual(['read_uploaded_file', 'generate_deliverable']);
    expect(decision.pythonExposed).toBe(false);
  });

  it('D: "make a PowerPoint from this PDF" -> FILE_CONVERSION, skills [pdf, pptx], read_uploaded_file + generate_deliverable, no Python', () => {
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
    expect(decision.selectedSkills).toEqual(['pdf', 'pptx']);
    expect(decision.exposedTools).toEqual(['read_uploaded_file', 'generate_deliverable']);
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

  it('Computation request -> COMPUTATION, exposes run_python', () => {
    const decision = routeTurn({
      prompt: 'Run a Monte Carlo simulation with 10,000 trials to calculate option price',
      mode: 'chat',
      hasAttachments: false,
      candidateSkills,
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('COMPUTATION');
    expect(decision.exposedTools).toContain('run_python');
    expect(decision.pythonExposed).toBe(true);
  });
});
