/**
 * ArcNave Phase 7 Sandbox Data Bridge.
 *
 * Implements strict boundary isolation between model-visible handles and internal storage:
 * - The model NEVER sees or controls internal `storageKey`.
 * - The model interacts solely with opaque `datasetHandle` (e.g. "ds_a1b2c3d4").
 * - Resolves handles to server-side dataset records and prepares secure sandbox execution mounts.
 */

import { analyticsSessionService } from './session.js';
import type { AnalysisDataset } from '../../db/schema.js';

export class SandboxDataBridge {
  /**
   * Resolves a dataset handle to an authorized dataset record for a session.
   * Throws if handle is invalid or does not belong to the session.
   */
  async resolveDataset(sessionId: string, datasetHandle: string): Promise<AnalysisDataset> {
    const dataset = await analyticsSessionService.getDatasetByHandle(sessionId, datasetHandle);
    if (!dataset) {
      throw new Error(`Dataset handle "${datasetHandle}" is not found or not authorized for this session.`);
    }

    // Check if derived dataset TTL expired
    if (dataset.expiresAt && new Date(dataset.expiresAt) < new Date()) {
      throw new Error(
        `Dataset "${datasetHandle}" (Version ${dataset.version}) has expired. Recomputing from source lineage...`,
      );
    }

    return dataset;
  }

  /**
   * Generates standard, reproducible Python preamble for sandbox execution.
   * Mounts the dataset via a sanitized local sandbox path matching datasetHandle,
   * completely isolating the true storageKey / bucket / cloud URI.
   */
  buildSandboxPreamble(datasetHandle: string): string {
    const sanitizedHandle = datasetHandle.replace(/[^a-zA-Z0-9_]/g, '');
    return `# ArcNave Automated Data Loader
import pandas as pd
import numpy as np

# Load dataset via model-safe handle
DATASET_PATH = "/workspace/data/${sanitizedHandle}.csv"
try:
    df = pd.read_csv(DATASET_PATH)
    print(f"Loaded dataset ${sanitizedHandle}: {df.shape[0]} rows, {df.shape[1]} columns")
except Exception as e:
    print(f"Error loading {sanitizedHandle}: {e}")
`;
  }
}

export const sandboxDataBridge = new SandboxDataBridge();
