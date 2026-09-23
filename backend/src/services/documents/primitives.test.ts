import { describe, expect, it } from 'vitest';
import {
  CommonOperationResultSchema,
  DeliverableWarningSchema,
  IntermediateArtifactRefSchema,
  SourceReferenceSchema,
  TypedValueSchema,
} from './primitives.js';
import {
  createWorkspaceArtifact,
  resolveWorkspaceArtifact,
} from '../../tools/execution/workspaceArtifacts.js';

describe('Common Foundation Primitives', () => {
  describe('TypedValueSchema', () => {
    it('validates string values', () => {
      const parsed = TypedValueSchema.safeParse({ type: 'string', value: 'Revenue Q2' });
      expect(parsed.success).toBe(true);
    });

    it('validates numeric and integer values', () => {
      const numParsed = TypedValueSchema.safeParse({
        type: 'number',
        value: 1250000.5,
        format: '#,##0.00',
        currency: 'USD',
      });
      expect(numParsed.success).toBe(true);

      const intParsed = TypedValueSchema.safeParse({
        type: 'integer',
        value: 42,
      });
      expect(intParsed.success).toBe(true);

      const nonInt = TypedValueSchema.safeParse({
        type: 'integer',
        value: 42.5,
      });
      expect(nonInt.success).toBe(false);
    });

    it('validates boolean values', () => {
      const boolParsed = TypedValueSchema.safeParse({ type: 'boolean', value: true });
      expect(boolParsed.success).toBe(true);
    });

    it('validates date (YYYY-MM-DD) and datetime (ISO 8601) values', () => {
      const dateParsed = TypedValueSchema.safeParse({ type: 'date', value: '2026-09-23' });
      expect(dateParsed.success).toBe(true);

      const badDate = TypedValueSchema.safeParse({ type: 'date', value: '23-09-2026' });
      expect(badDate.success).toBe(false);

      const dtParsed = TypedValueSchema.safeParse({
        type: 'datetime',
        value: '2026-09-23T09:30:00.000Z',
      });
      expect(dtParsed.success).toBe(true);

      const badDt = TypedValueSchema.safeParse({
        type: 'datetime',
        value: 'not-a-datetime',
      });
      expect(badDt.success).toBe(false);
    });

    it('validates formula values', () => {
      const formulaParsed = TypedValueSchema.safeParse({
        type: 'formula',
        value: 'SUM(C2:C100)',
      });
      expect(formulaParsed.success).toBe(true);
    });

    it('validates null values', () => {
      const nullParsed = TypedValueSchema.safeParse({ type: 'null', value: null });
      expect(nullParsed.success).toBe(true);
    });
  });

  describe('SourceReferenceSchema', () => {
    it('validates source reference with all optional fields', () => {
      const res = SourceReferenceSchema.safeParse({
        attachmentId: 'att-1234',
        page: 2,
        sheet: 'Ledger',
        row: 15,
        column: 'Debit',
        region: 'top-right',
        extractionMethod: 'gemini-native-pdf',
        confidence: 0.98,
      });
      expect(res.success).toBe(true);
    });
  });

  describe('DeliverableWarningSchema', () => {
    it('validates standard warning structure', () => {
      const warn = DeliverableWarningSchema.safeParse({
        severity: 'warning',
        type: 'unreadable_region',
        message: 'Table row 14 was blurry in source scan',
        source: { attachmentId: 'att-555', page: 3 },
        repairable: true,
      });
      expect(warn.success).toBe(true);
    });
  });

  describe('CommonOperationResultSchema', () => {
    it('validates successful operation result', () => {
      const op = CommonOperationResultSchema.safeParse({
        status: 'success',
        summary: { processedPages: 12, rowsExtracted: 187 },
        outputs: [
          {
            filename: 'statement.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: 15420,
          },
        ],
        metrics: { executionDurationMs: 450 },
        intermediateRefs: ['temp/chunk-001.json'],
      });
      expect(op.success).toBe(true);
    });
  });

  describe('IntermediateArtifactRefSchema', () => {
    it('validates artifact reference object', () => {
      const res = IntermediateArtifactRefSchema.safeParse({ artifactRef: 'artifact_1234567890abcdef' });
      expect(res.success).toBe(true);

      const invalid = IntermediateArtifactRefSchema.safeParse({ artifactRef: '' });
      expect(invalid.success).toBe(false);
    });
  });
});
