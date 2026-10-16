/**
 * Stored bytes can be shared: a project file picked into a chat gives the attachment the
 * project file's own key, and one project file can be picked into many chats. Every path that
 * deletes bytes asks here first, so deleting one row never takes bytes another row still
 * reads (D1 #17: deleting a project file broke every chat it had been picked into).
 */
import { and, eq, ne, notInArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { attachments, projectFiles } from '../../db/schema.js';

/** A database or a transaction: anything that can select. */
type Reader = Pick<Database, 'select'>;

export async function storageKeyInUse(
  db: Reader,
  storageKey: string,
  except: { attachmentIds?: string[]; projectFileId?: string } = {},
): Promise<boolean> {
  const ids = except.attachmentIds ?? [];
  const [att] = await db
    .select({ one: sql<number>`1` })
    .from(attachments)
    .where(and(eq(attachments.storageKey, storageKey), ids.length ? notInArray(attachments.id, ids) : undefined))
    .limit(1);
  if (att) return true;
  const [file] = await db
    .select({ one: sql<number>`1` })
    .from(projectFiles)
    .where(
      and(
        eq(projectFiles.storageKey, storageKey),
        except.projectFileId ? ne(projectFiles.id, except.projectFileId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(file);
}
