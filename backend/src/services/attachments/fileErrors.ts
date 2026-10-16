/**
 * Why a file failed, and what the user is told (Stage 15 ER-9 / EH12, Stage 9 PIPE).
 *
 * The code is stored on the row (`error_code`) and the frontend switches on it; the text is
 * what the chip shows. No library's own error message ever reaches a user: an extractor's
 * exception is classified into one of these codes, and only the code's copy is shown (D1 #23).
 *
 * The ten ER-9 codes are the locked list. The `zip_*` codes are ours: UD-2 lists the ZIP
 * cases each refusal must cover but gives them no codes, and one code per case is what lets
 * the user (and a test) tell a nested archive from an unsafe path.
 */

export const ER9_CODES = [
  'unsupported_type',
  'too_large',
  'too_many_pages',
  'encrypted',
  'corrupt',
  'malware',
  'ocr_failed',
  'ocr_blocked',
  'timeout',
  'quota',
] as const;

export const ZIP_CODES = [
  'zip_nested',
  'zip_unsafe_path',
  'zip_symlink',
  'zip_ratio',
  'zip_too_many_members',
  'zip_too_large_unpacked',
  'zip_encrypted',
  'zip_member_type',
] as const;

/**
 * Stage 9 SCAN: "blocked as `malware` / `scan_incomplete`". `malware` is in ER-9; a scan that
 * could not finish (the stream was over clamd's limit, an encrypted archive, clamd down) is
 * its own code, so the file is never shown as scanned when it was not (ADR-0063).
 */
export const SCAN_CODES = ['scan_incomplete'] as const;

export type FileErrorCode = (typeof ER9_CODES)[number] | (typeof ZIP_CODES)[number] | (typeof SCAN_CODES)[number];

/** A failure with its code. Thrown inside the pipeline; caught once, where the row is written. */
export class FileFailure extends Error {
  override name = 'FileFailure';
  constructor(
    readonly code: FileErrorCode,
    /** Overrides the copy when the case needs specifics (the page count, the format to save as). */
    readonly detail?: string,
  ) {
    super(code);
  }
}

const COPY: Record<FileErrorCode, string> = {
  unsupported_type: 'This file type is not supported. Try a PDF, Word, Excel, PowerPoint, image, audio, ZIP, CSV, TXT or MD file.',
  too_large: 'This file is larger than the limit for its type. Choose a smaller file.',
  too_many_pages: 'This document has more pages than the limit. Split it and upload the parts.',
  encrypted: 'This file is protected by a password. Remove the password and upload it again.',
  corrupt: 'This file could not be opened. It may be damaged. Save it again and upload it.',
  malware: 'This file was removed because it looks harmful.',
  ocr_failed: 'The scanned pages of this file could not be read. Retry, or remove it.',
  ocr_blocked: 'The scanned pages of this file could not be read and retrying will not help.',
  timeout: 'Reading this file took too long. Retry, or remove it.',
  quota: 'You have reached today’s upload limit. Try again tomorrow.',
  zip_nested: 'This ZIP contains another ZIP. Unpack the inner ZIP and upload its files.',
  zip_unsafe_path: 'This ZIP has a file whose path leaves the archive. It was not opened.',
  zip_symlink: 'This ZIP contains a link instead of a file. It was not opened.',
  zip_ratio: 'This ZIP expands far more than normal files do, so it was not opened.',
  zip_too_many_members: 'This ZIP has more files than the limit. Upload at most 20 files at a time.',
  zip_too_large_unpacked: 'This ZIP is too large once unpacked. The limit is 500 MB of files.',
  zip_encrypted: 'This ZIP is protected by a password. Unpack it and upload the files instead.',
  zip_member_type: 'This ZIP contains a file type that is not supported, so it was not opened.',
  scan_incomplete: 'This file could not be checked for harmful content, so it was not opened. Retry, or remove it.',
};

export function fileErrorText(code: FileErrorCode, detail?: string): string {
  return detail ?? COPY[code];
}

/** Locked "save as" text for macro and legacy Office files (Stage 1 FT-2 / FT-3, Stage 9 D9-12). */
export function saveAsText(extension: string): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  const target = ext.startsWith('doc') ? 'DOCX' : ext.startsWith('xls') ? 'XLSX' : 'PPTX';
  const why = ext.endsWith('m') ? 'contains macros' : 'is in an old Office format';
  return `This .${ext} file ${why}. Save it as ${target} and upload it again.`;
}

/** Notes on a readable file. Codes are ours; the user reads the detail. */
export type FileWarningCode =
  | 'text_partial'
  | 'no_text_layer'
  | 'text_only'
  | 'chunk_cap'
  | 'not_extracted'
  | 'zip_members'
  /** Some scanned pages could not be read (OCR-M11: the page is failed, the file is not). */
  | 'ocr_partial'
  /** Scanned pages with no OCR engine configured. */
  | 'ocr_unavailable'
  | 'transcript_partial'
  /** A text file that is not UTF-8 or UTF-16 was read as Windows-1252. */
  | 'encoding_guess'
  | 'formula_no_value'
  | 'hidden_sheets'
  | 'embedded_files_ignored'
  /** PDF JavaScript / OpenAction / Launch actions removed from the stored copy (Stage 9 SCAN). */
  | 'active_content_removed'
  /** A large file: only its first parts can be retrieved (E4 cap on derivative chunks). */
  | 'retrieval_partial';

export function warning(code: FileWarningCode, detail: string): { code: FileWarningCode; detail: string } {
  return { code, detail };
}
