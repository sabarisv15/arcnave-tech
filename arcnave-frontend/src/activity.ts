import type { ToolCall } from './types';

const labels: Record<string, [string, string, string]> = {
  run_python: ['Running a calculation', 'Ran a calculation', 'Executed code for this request.'],
  extract_scanned_table_rows: ['Reading table rows', 'Read table rows', 'Extracted rows from the attached document.'],
  analyze_table_rows: ['Analyzing table rows', 'Analyzed table rows', 'Processed the extracted table rows.'],
  read_uploaded_file: ['Reading a file', 'Read a file', 'Read the attached file content.'],
  read_project_file: ['Reading a file', 'Read a file', 'Read a project file.'],
  search_project_files: ['Searching files', 'Searched files', 'Searched project files for relevant content.'],
  search_tools: ['Finding available tools', 'Found available tools', 'Looked up tools for this task.'],
  search_skills: ['Finding workflow guidance', 'Searched workflow guidance', 'Looked up relevant workflow guidance.'],
  load_skill: ['Reading workflow guidance', 'Read workflow guidance', 'Loaded instructions for this task.'],
  read_skill: ['Reading workflow guidance', 'Read workflow guidance', 'Loaded instructions for this task.'],
  generate_deliverable: ['Creating a file', 'Created a file', 'Generated an output file.'],
  create_artifact: ['Creating an artifact', 'Created an artifact', 'Created an artifact for this request.'],
  update_artifact: ['Updating an artifact', 'Updated an artifact', 'Updated the artifact content.'],
  read_artifact: ['Reading an artifact', 'Read an artifact', 'Read the artifact content.'],
  generate_image: ['Creating an image', 'Created an image', 'Generated an image for this request.'],
  web_search: ['Searching the web', 'Searched the web', 'Retrieved web search results.'],
  inspectPdf: ['Reading a PDF', 'Read a PDF', 'Inspected the PDF structure.'],
  mergePdfFiles: ['Merging PDFs', 'Merged PDFs', 'Combined the selected PDF files.'],
  splitPdfFile: ['Splitting a PDF', 'Split a PDF', 'Separated the selected PDF pages.'],
  inspectSpreadsheet: ['Reading a spreadsheet', 'Read a spreadsheet', 'Inspected the workbook structure.'],
  editSpreadsheetCells: ['Updating spreadsheet cells', 'Updated spreadsheet cells', 'Applied the requested cell edits.'],
  combineWorkbooks: ['Combining spreadsheets', 'Combined spreadsheets', 'Combined the selected workbooks.'],
  inspectDocxStructure: ['Reading a document', 'Read a document', 'Inspected the document structure.'],
  editDocxContent: ['Editing a document', 'Edited a document', 'Applied the requested text edits.'],
  appendDocxSection: ['Adding a document section', 'Added a document section', 'Appended the requested section.'],
  inspectPptxStructure: ['Reading a presentation', 'Read a presentation', 'Inspected the presentation structure.'],
  reorderPptxSlides: ['Reordering slides', 'Reordered slides', 'Applied the requested slide order.'],
  editPptxSlideText: ['Editing slide text', 'Edited slide text', 'Applied the requested slide text edits.'],
};

export function activityCopy(call: ToolCall, settled = false) {
  const label = labels[call.name] ?? ['Working on a step', 'Completed a step', 'Completed an action for this request.'];
  const input = call.input && typeof call.input === 'object' ? call.input as Record<string, unknown> : {};
  const description = call.name === 'run_python' && typeof input.description === 'string'
    ? input.description.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  const action = description || label[0];
  if (call.ok === false) return { title: `${action} — failed`, detail: 'This step failed. Its result could not be confirmed.' };
  if (call.ok === undefined) return { title: settled ? `${action} — interrupted` : action, detail: settled ? 'This step ended without a confirmed result.' : 'This step is in progress.' };
  if (call.outputFiles?.length) return { title: call.outputFiles.length === 1 ? 'Created a file' : `Created ${call.outputFiles.length} files`, detail: call.outputFiles.join(', ') };
  return { title: description ? `${description} — complete` : label[1], detail: label[2] };
}

export type ResponsePart = { kind: 'text'; text: string } | { kind: 'activity'; calls: ToolCall[] };

/** Offsets refer to the original UTF-16 response, never to trimmed Markdown. */
export function responseParts(text: string, calls: ToolCall[] = []): ResponsePart[] {
  const parts: ResponsePart[] = [];
  let cursor = 0;
  for (const call of calls.filter(c => c.name !== 'render_ui')) {
    // Older transcripts have no ordering evidence: keep their steps after the answer.
    const offset = typeof call.textOffset === 'number' && Number.isFinite(call.textOffset)
      ? Math.max(cursor, Math.min(text.length, Math.floor(call.textOffset))) : text.length;
    if (offset > cursor) parts.push({ kind: 'text', text: text.slice(cursor, offset) });
    const previous = parts.at(-1);
    if (previous?.kind === 'activity') previous.calls.push(call);
    else parts.push({ kind: 'activity', calls: [call] });
    cursor = offset;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}
