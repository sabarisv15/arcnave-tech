import type { ToolResult } from '../providers/types.js';

/** Only persisted outputs establish that files were created, never requested filenames. */
export function activityOutputFiles(result: ToolResult): string[] {
  if (!result.ok) return [];
  return result.content.flatMap(block => {
    if (block.type !== 'json' || !block.data || typeof block.data !== 'object') return [];
    const data = block.data as Record<string, unknown>;
    const files = Array.isArray(data.persistedFiles) ? data.persistedFiles
      : Array.isArray(data.files) ? data.files
      : data.file && typeof data.file === 'object' ? [data.file] : [data];
    return files.flatMap(file => file && typeof file === 'object' &&
      typeof file.filename === 'string' && typeof file.downloadUrl === 'string'
      ? [file.filename.slice(0, 255)] : []);
  }).slice(0, 20);
}
