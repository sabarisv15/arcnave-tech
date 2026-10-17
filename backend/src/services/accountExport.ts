/**
 * Everything an account holds, as one zip (WP-13, ADR-0040).
 *
 * Built from the rows the account owns, never from what a client says it owns. Conversation
 * files are listed by name but their bytes are not included; artifact
 * versions are included whole, text and binary.
 */
import { strToU8, zipSync } from 'fflate';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { DbLike } from '../db/client.js';
import {
  artifacts,
  artifactVersions,
  attachments,
  chats,
  memoryItems,
  messages,
  messageSources,
  preferences,
  projectFiles,
  projects,
  styles,
  toolCalls,
  users,
} from '../db/schema.js';
import { MEMORY_EXPORT_VERSION } from './memory/memoryTransfer.js';
import type { ObjectStorage } from './storage.js';

const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2));
/** A path segment from a title: readable, and never a directory or a hidden file. */
const segment = (title: string, id: string) =>
  `${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'untitled'}-${id.slice(0, 8)}`;

const README = `ArcNave data export

account.json        your account: email, name, when it was made
preferences.json    your settings
memory.json         your memories; Settings > Memory > Import reads this file back
styles.json         your custom response styles
projects.json       your projects, their instructions and the names of their files
conversations.json  every conversation with its messages, citations and tool steps;
                    attached files are listed by name, their contents are not included
artifacts/          every version of every artifact: .md for text, the file itself for exports
`;

export async function buildAccountExport(db: DbLike, storage: ObjectStorage, userId: string): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { 'README.txt': strToU8(README) };

  const [user] = await db
    .select({ email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  files['account.json'] = json(user ?? {});

  const [prefs] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  if (prefs) {
    const { userId: _u, version: _v, ...rest } = prefs;
    files['preferences.json'] = json(rest);
  }

  const memory = await db.select().from(memoryItems).where(eq(memoryItems.userId, userId)).orderBy(asc(memoryItems.createdAt));
  files['memory.json'] = json({
    version: MEMORY_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    items: memory.map((m) => ({ key: m.key, content: m.content, kind: m.kind, isStanding: m.isStanding, projectId: m.projectId })),
  });

  const styleRows = await db
    .select({ name: styles.name, instructions: styles.instructions, createdAt: styles.createdAt })
    .from(styles)
    .where(eq(styles.userId, userId));
  files['styles.json'] = json(styleRows);

  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)));
  const fileRows = projectRows.length
    ? await db
        .select({ projectId: projectFiles.projectId, filename: projectFiles.filename, sizeBytes: projectFiles.sizeBytes, createdAt: projectFiles.createdAt })
        .from(projectFiles)
        .where(inArray(projectFiles.projectId, projectRows.map((p) => p.id)))
    : [];
  files['projects.json'] = json(
    projectRows.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      instructions: p.instructions,
      createdAt: p.createdAt,
      files: fileRows.filter((f) => f.projectId === p.id).map(({ projectId: _p, ...f }) => f),
    })),
  );

  const chatRows = await db
    .select()
    .from(chats)
    .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)))
    .orderBy(asc(chats.createdAt));
  const conversations = [];
  for (const chat of chatRows) {
    const rows = await db.select().from(messages).where(eq(messages.chatId, chat.id)).orderBy(asc(messages.seq));
    const ids = rows.map((m) => m.id);
    const [sources, calls, files_] = ids.length
      ? await Promise.all([
          db.select().from(messageSources).where(inArray(messageSources.messageId, ids)),
          db.select().from(toolCalls).where(inArray(toolCalls.messageId, ids)),
          db.select({ messageId: attachments.messageId, filename: attachments.filename, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes })
            .from(attachments)
            .where(inArray(attachments.messageId, ids)),
        ])
      : [[], [], []];
    conversations.push({
      id: chat.id,
      title: chat.title,
      projectId: chat.projectId,
      versionOf: chat.rootChatId,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: rows.map((m) => ({
        role: m.role,
        text: m.text,
        status: m.status,
        model: m.modelAlias,
        createdAt: m.createdAt,
        attachments: files_.filter((f) => f.messageId === m.id).map(({ messageId: _m, ...f }) => f),
        sources: sources.filter((s) => s.messageId === m.id).map((s) => ({ id: s.ordinal, title: s.title, url: s.url })),
        toolSteps: calls
          .filter((c) => c.messageId === m.id)
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((c) => ({ tool: c.name, input: c.input, ok: c.ok })),
      })),
    });
  }
  files['conversations.json'] = json(conversations);

  const artifactRows = await db.select().from(artifacts).where(eq(artifacts.userId, userId));
  for (const artifact of artifactRows) {
    const dir = `artifacts/${segment(artifact.title, artifact.id)}`;
    const versions = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifact.id))
      .orderBy(asc(artifactVersions.version));
    for (const v of versions) {
      if (v.format === 'markdown') {
        const ext = artifact.kind === 'webpage' ? 'html' : artifact.kind === 'svg' ? 'svg' : 'md';
        files[`${dir}/v${v.version}.${ext}`] = strToU8(v.content);
      } else if (v.storageKey) {
        try {
          files[`${dir}/v${v.version}.${v.format}`] = new Uint8Array(await storage.get(v.storageKey));
        } catch {
          // benign: a version whose bytes are gone is exported as a .missing.txt note
          files[`${dir}/v${v.version}.${v.format}.missing.txt`] = strToU8('This version is no longer stored.');
        }
      }
    }
  }

  return zipSync(files, { level: 6 });
}
