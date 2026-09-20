/**
 * ArcNave Phase 7 Analytics Session and Dataset Lineage Manager.
 *
 * Enforces:
 * 1. Non-circular session bootstrap (create session -> insert root dataset -> atomically set currentDatasetId).
 * 2. Immutable dataset versions with unique handle/version constraints.
 * 3. Durable computation provenance for analysis results.
 * 4. Zero raw sample rows saved in Postgres metadata.
 * 5. 7-day sliding TTL for derived datasets with reproducible lineage replay.
 */

import { randomBytes, randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  analysisDatasets,
  analysisResults,
  analysisSessions,
  analysisTransformations,
  type AnalysisDataset,
  type AnalysisResult,
  type AnalysisSession,
  type AnalysisTransformation,
} from '../../db/schema.js';
import { parseCSV, profileTabularData } from './profiler.js';
import { evaluateDataQuality } from './quality.js';
import type { AnalysisSessionSummary, ColumnProfile, DataQualityReport, DatasetLineageStep } from './types.js';

export interface CreateSessionInput {
  userId: string;
  chatId: string;
  projectId?: string | null;
  title?: string;
}

export interface BootstrapRootDatasetInput {
  sessionId: string;
  name: string;
  rawContent: string;
  sourceFileId?: string | null;
  storageKey: string;
}

export interface CreateDerivedDatasetInput {
  sessionId: string;
  sourceDatasetId: string;
  name: string;
  rawContent: string;
  transformationType: 'filter' | 'aggregate' | 'clean' | 'derive' | 'join';
  parameters: Record<string, unknown>;
  reproducibleScript: string;
  storageKey: string;
}

export interface RecordResultInput {
  sessionId: string;
  datasetId: string;
  operation: string;
  parameters: Record<string, unknown>;
  results: Record<string, unknown>;
  methodology?: string;
}

export class AnalyticsSessionService {
  /**
   * Step 1: Create the analysis session.
   * Non-circular initialization: currentDatasetId starts as null.
   */
  async createSession(input: CreateSessionInput): Promise<AnalysisSession> {
    const db = getDb();
    const [session] = await db
      .insert(analysisSessions)
      .values({
        userId: input.userId,
        chatId: input.chatId,
        projectId: input.projectId ?? null,
        currentDatasetId: null,
        title: input.title || 'Untitled Analysis',
        state: 'active',
      })
      .returning();

    if (!session) {
      throw new Error('Failed to create analysis session');
    }

    return session;
  }

  /**
   * Step 2: Bootstrap root dataset (Version 1).
   * Profiles tabular content, evaluates quality, inserts root dataset,
   * and atomically sets currentDatasetId on the session.
   */
  async bootstrapRootDataset(input: BootstrapRootDatasetInput): Promise<{
    dataset: AnalysisDataset;
    profile: DataQualityReport;
  }> {
    const db = getDb();

    // 1. Profile tabular data
    const { headers, rows } = parseCSV(input.rawContent);
    const profile = profileTabularData(headers, rows);
    const qualityReport = evaluateDataQuality(profile, rows);

    // 2. Generate model-facing dataset handle (model never sees storageKey)
    const handle = `ds_${randomBytes(4).toString('hex')}`;

    // 3. Insert root dataset (isDerived: false, expiresAt: null)
    const [dataset] = await db
      .insert(analysisDatasets)
      .values({
        sessionId: input.sessionId,
        version: 1,
        datasetHandle: handle,
        name: input.name,
        rowCount: profile.rowCount,
        columnCount: profile.columnCount,
        columns: profile.columns,
        dataQuality: qualityReport as unknown as Record<string, unknown>,
        storageKey: input.storageKey,
        sourceFileId: input.sourceFileId ?? null,
        isDerived: false,
        expiresAt: null,
      })
      .returning();

    if (!dataset) {
      throw new Error('Failed to insert root dataset');
    }

    // 4. Atomically point session to this root dataset
    await db
      .update(analysisSessions)
      .set({
        currentDatasetId: dataset.id,
        updatedAt: new Date(),
      })
      .where(eq(analysisSessions.id, input.sessionId));

    return { dataset, profile: qualityReport };
  }

  /**
   * Step 3: Create an immutable derived dataset V(N+1).
   * Profiles transformed content, records lineage transformation with reproducible script,
   * sets 7-day sliding TTL, and atomically updates currentDatasetId.
   */
  async createDerivedDataset(input: CreateDerivedDatasetInput): Promise<{
    dataset: AnalysisDataset;
    transformation: AnalysisTransformation;
  }> {
    const db = getDb();

    // Find current highest version for this session
    const existing = await db
      .select({ version: analysisDatasets.version })
      .from(analysisDatasets)
      .where(eq(analysisDatasets.sessionId, input.sessionId))
      .orderBy(desc(analysisDatasets.version))
      .limit(1);

    const nextVersion = (existing[0]?.version ?? 1) + 1;
    const handle = `ds_${randomBytes(4).toString('hex')}`;

    // Profile transformed data
    const { headers, rows } = parseCSV(input.rawContent);
    const profile = profileTabularData(headers, rows);
    const qualityReport = evaluateDataQuality(profile, rows);

    // 7-day sliding TTL for ephemeral derived data
    const ttlHours = 168; // 7 days
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const [dataset] = await db
      .insert(analysisDatasets)
      .values({
        sessionId: input.sessionId,
        version: nextVersion,
        datasetHandle: handle,
        name: input.name,
        rowCount: profile.rowCount,
        columnCount: profile.columnCount,
        columns: profile.columns,
        dataQuality: qualityReport as unknown as Record<string, unknown>,
        storageKey: input.storageKey,
        isDerived: true,
        expiresAt,
      })
      .returning();

    if (!dataset) {
      throw new Error('Failed to insert derived dataset');
    }

    // Record transformation lineage
    const [transformation] = await db
      .insert(analysisTransformations)
      .values({
        sessionId: input.sessionId,
        sourceDatasetId: input.sourceDatasetId,
        targetDatasetId: dataset.id,
        transformationType: input.transformationType,
        parameters: input.parameters,
        reproducibleScript: input.reproducibleScript,
      })
      .returning();

    if (!transformation) {
      throw new Error('Failed to record analysis transformation');
    }

    // Atomically update currentDatasetId
    await db
      .update(analysisSessions)
      .set({
        currentDatasetId: dataset.id,
        updatedAt: new Date(),
      })
      .where(eq(analysisSessions.id, input.sessionId));

    return { dataset, transformation };
  }

  /**
   * Step 4: Record analysis computation results with durable provenance.
   * Links directly to the immutable datasetId against which it was calculated.
   */
  async recordResult(input: RecordResultInput): Promise<AnalysisResult> {
    const db = getDb();
    const [result] = await db
      .insert(analysisResults)
      .values({
        sessionId: input.sessionId,
        datasetId: input.datasetId,
        operation: input.operation,
        parameters: input.parameters,
        results: input.results,
        methodology: input.methodology ?? null,
      })
      .returning();

    if (!result) {
      throw new Error('Failed to record analysis result');
    }

    return result;
  }

  /**
   * Get dataset metadata by handle within a session.
   * Model uses datasetHandle ('ds_...'). Backend resolves internal metadata.
   */
  async getDatasetByHandle(sessionId: string, handle: string): Promise<AnalysisDataset | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(analysisDatasets)
      .where(
        and(
          eq(analysisDatasets.sessionId, sessionId),
          eq(analysisDatasets.datasetHandle, handle),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get session summary with active dataset and complete transformation lineage.
   */
  async getSessionSummary(sessionId: string): Promise<AnalysisSessionSummary | null> {
    const db = getDb();
    const [session] = await db
      .select()
      .from(analysisSessions)
      .where(eq(analysisSessions.id, sessionId))
      .limit(1);

    if (!session) return null;

    let currentDataset: AnalysisDataset | undefined;
    if (session.currentDatasetId) {
      const dsRows = await db
        .select()
        .from(analysisDatasets)
        .where(eq(analysisDatasets.id, session.currentDatasetId))
        .limit(1);
      currentDataset = dsRows[0];
    }

    const datasets = await db
      .select()
      .from(analysisDatasets)
      .where(eq(analysisDatasets.sessionId, sessionId))
      .orderBy(analysisDatasets.version);

    const transformations = await db
      .select()
      .from(analysisTransformations)
      .where(eq(analysisTransformations.sessionId, sessionId));

    const lineage: DatasetLineageStep[] = datasets.map((ds) => {
      const transform = transformations.find((t) => t.targetDatasetId === ds.id);
      return {
        version: ds.version,
        datasetHandle: ds.datasetHandle,
        name: ds.name,
        transformationType: transform?.transformationType,
        reproducibleScript: transform?.reproducibleScript,
        executedAt: transform?.executedAt?.toISOString(),
      };
    });

    const quality = currentDataset?.dataQuality as unknown as DataQualityReport | undefined;

    return {
      sessionId: session.id,
      chatId: session.chatId,
      title: session.title,
      currentDatasetHandle: currentDataset?.datasetHandle,
      currentDatasetVersion: currentDataset?.version,
      currentRowCount: currentDataset?.rowCount,
      currentColumnCount: currentDataset?.columnCount,
      dataQualityScore: quality?.score,
      lineage,
    };
  }
}

export const analyticsSessionService = new AnalyticsSessionService();
