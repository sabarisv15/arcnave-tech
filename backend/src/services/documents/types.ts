/**
 * Core type definitions for ArcNave's format-native deliverable architecture.
 */

export type ExportFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf';

export const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

export class MarkdownConversionUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkdownConversionUnsupported';
  }
}

export interface ArtifactImage {
  buffer: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  aspectRatio: number;
}

export type DocumentBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string; level?: number }
  | { type: 'callout'; text: string }
  | { type: 'pagebreak' }
  | { type: 'section'; orientation: 'portrait' | 'landscape' }
  | { type: 'image'; alt: string; src: string; width?: number; height?: number }
  | { type: 'table'; header: string[]; rows: string[][] };

export interface DocumentSpec {
  title: string;
  blocks: DocumentBlock[];
}

export interface SheetSpec {
  name: string;
  header: string[];
  rows: string[][];
  notes?: string[];
  hasChart?: boolean;
}

export interface SpreadsheetSpec {
  sheets: SheetSpec[];
}

export interface SlideTable {
  header: string[];
  rows: string[][];
}

export interface SlideCard {
  title: string;
  body: string;
}

export interface SlideImage {
  alt: string;
  src: string;
}

export interface SlideItem {
  title: string;
  bullets: string[];
  table?: SlideTable;
  cards?: SlideCard[];
  image?: SlideImage;
  columns?: { left: string[]; right: string[] };
  notes?: string;
}

export interface SlidesSpec {
  slides: SlideItem[];
}

export interface VerificationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  metrics?: Record<string, number | string | boolean>;
}
