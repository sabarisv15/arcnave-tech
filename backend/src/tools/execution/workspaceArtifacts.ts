import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFiles } from './executionRuntime.js';

interface ArtifactManifestEntry {
  opaqueId: string;
  relativePath: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

interface ArtifactManifest {
  artifacts: Record<string, ArtifactManifestEntry>;
}

const MANIFEST_FILENAME = '.artifact_manifest.json';

/**
 * Validates that a path is safe and strictly relative without traversal.
 */
function validateSafeRelative(rel: string): boolean {
  if (!rel || typeof rel !== 'string') return false;
  const clean = rel.trim().replace(/\\/g, '/');
  if (path.isAbsolute(clean)) return false;
  if (/^[a-zA-Z]:/.test(clean)) return false; // Windows drive letter
  if (clean.includes('..')) return false;

  const normalized = path.normalize(clean).replace(/\\/g, '/');
  if (normalized.startsWith('../') || normalized === '..') return false;
  return true;
}

async function loadManifest(workspace: WorkspaceFiles): Promise<ArtifactManifest> {
  const manifestPath = path.join(workspace.tempDir, MANIFEST_FILENAME);
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    // benign: no manifest yet: no artifacts
    return { artifacts: {} };
  }
}

async function saveManifest(workspace: WorkspaceFiles, manifest: ArtifactManifest): Promise<void> {
  await fs.mkdir(workspace.tempDir, { recursive: true });
  const manifestPath = path.join(workspace.tempDir, MANIFEST_FILENAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Creates an opaque artifact reference in the workspace for a given relative target path.
 * The model receives only the opaque ID (e.g. "artifact_9a8b7c6d5e4f3a2b") and never raw filesystem paths.
 */
export async function createWorkspaceArtifact(
  workspace: WorkspaceFiles,
  relativeTarget: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  if (!validateSafeRelative(relativeTarget)) {
    throw new Error(`Invalid relative artifact path "${relativeTarget}": path traversal or disallowed syntax.`);
  }

  const cleanTarget = relativeTarget.trim().replace(/\\/g, '/');
  const opaqueId = `artifact_${crypto.randomBytes(8).toString('hex')}`;

  const manifest = await loadManifest(workspace);
  manifest.artifacts[opaqueId] = {
    opaqueId,
    relativePath: cleanTarget,
    metadata,
    createdAt: Date.now(),
  };

  await saveManifest(workspace, manifest);
  return opaqueId;
}

/**
 * Resolves an opaque or validated relative artifact reference to its absolute filesystem path.
 * Guarantees that the resolved path stays strictly within the active workspace bounds.
 */
export async function resolveWorkspaceArtifact(
  workspace: WorkspaceFiles,
  artifactRef: string,
): Promise<string> {
  if (!artifactRef || typeof artifactRef !== 'string') {
    throw new Error('Artifact reference must be a non-empty string.');
  }

  const cleanRef = artifactRef.trim().replace(/\\/g, '/');
  let relativeTarget: string;

  if (cleanRef.startsWith('artifact_')) {
    const manifest = await loadManifest(workspace);
    const entry = manifest.artifacts[cleanRef];
    if (!entry) {
      throw new Error(`Artifact reference "${artifactRef}" does not exist in the active workspace.`);
    }
    relativeTarget = entry.relativePath;
  } else {
    // If a relative path was passed, validate safety
    if (!validateSafeRelative(cleanRef)) {
      throw new Error(`Disallowed artifact path traversal or format: "${artifactRef}".`);
    }
    relativeTarget = cleanRef;
  }

  let candidatePath: string;
  if (relativeTarget.startsWith('temp/')) {
    candidatePath = path.resolve(workspace.tempDir, relativeTarget.slice('temp/'.length));
  } else if (relativeTarget.startsWith('output/')) {
    candidatePath = path.resolve(workspace.outputDir, relativeTarget.slice('output/'.length));
  } else {
    candidatePath = path.resolve(workspace.tempDir, relativeTarget);
  }

  const allowedPrefixes = [
    path.resolve(workspace.tempDir) + path.sep,
    path.resolve(workspace.outputDir) + path.sep,
    path.resolve(workspace.workspaceDir) + path.sep,
  ];

  const isSafe =
    allowedPrefixes.some((p) => candidatePath.startsWith(p)) ||
    candidatePath === path.resolve(workspace.tempDir) ||
    candidatePath === path.resolve(workspace.outputDir);

  if (!isSafe) {
    throw new Error(`Artifact "${artifactRef}" resolves outside active workspace bounds.`);
  }

  return candidatePath;
}

/**
 * Writes data into the workspace intermediate area and returns an opaque artifact reference.
 */
export async function writeWorkspaceArtifact(
  workspace: WorkspaceFiles,
  targetOrRef: string,
  data: Buffer | string,
): Promise<string> {
  let opaqueId: string;
  let targetPath: string;

  if (targetOrRef.startsWith('artifact_')) {
    opaqueId = targetOrRef;
    targetPath = await resolveWorkspaceArtifact(workspace, targetOrRef);
  } else {
    opaqueId = await createWorkspaceArtifact(workspace, targetOrRef);
    targetPath = await resolveWorkspaceArtifact(workspace, opaqueId);
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, data);
  return opaqueId;
}

/**
 * Reads binary data from an intermediate artifact within the workspace.
 */
export async function readWorkspaceArtifact(
  workspace: WorkspaceFiles,
  artifactRef: string,
): Promise<Buffer> {
  const targetPath = await resolveWorkspaceArtifact(workspace, artifactRef);
  return fs.readFile(targetPath);
}
