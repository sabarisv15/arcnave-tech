/**
 * Versions of a conversation (ADR-0038).
 *
 * Editing a prompt copies the conversation before it into a new chat in the same family. Each
 * chat's messages from `forkSeq` on are its own; before that they are copies of its parent's.
 * So the message at a seq in a chat was first written by one chat, its *owner*, found by walking
 * up the parents. Two chats show the same prompt at a seq exactly when they have the same owner
 * there, and they are versions of one another at that seq when they had the same owner just
 * before it.
 */

export interface FamilyChat {
  id: string;
  parentChatId: string | null;
  forkSeq: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Highest message seq in the chat, or -1 when it has none. */
  lastSeq: number;
}

export interface MessageVersions {
  /** Position of the chat being read, 0-based, in `versions`. */
  index: number;
  /** One entry per version, oldest first; `chatId` is the chat to open to show it. */
  versions: Array<{ chatId: string; createdAt: string }>;
}

const START = 'start';

/** The chat that first wrote the message at `seq` in `chat`'s history. */
export function ownerAt(chat: FamilyChat, seq: number, byId: ReadonlyMap<string, FamilyChat>): string {
  if (seq < 0) return START;
  let current = chat;
  for (;;) {
    if (current.forkSeq === null || seq >= current.forkSeq) return current.id;
    const parent = current.parentChatId ? byId.get(current.parentChatId) : undefined;
    // A purged parent: nothing else can share this stretch, so it is this chat's alone.
    if (!parent) return `gone:${current.id}`;
    current = parent;
  }
}

/**
 * For each of `seqs` in `current`, the versions of that message, or nothing when there is only
 * one. Deleted chats are never offered, though they still link the chats branched from them.
 */
export function versionsAt(
  current: FamilyChat,
  family: readonly FamilyChat[],
  seqs: readonly number[],
): Map<number, MessageVersions> {
  const byId = new Map(family.map((c) => [c.id, c]));
  byId.set(current.id, current);
  const live = [...byId.values()].filter((c) => c.deletedAt === null);
  const out = new Map<number, MessageVersions>();

  for (const seq of seqs) {
    const before = ownerAt(current, seq - 1, byId);
    // owner at `seq` -> the chat to open for it
    const shown = new Map<string, FamilyChat>();
    for (const chat of live) {
      if (chat.lastSeq < seq || ownerAt(chat, seq - 1, byId) !== before) continue;
      const owner = ownerAt(chat, seq, byId);
      const best = shown.get(owner);
      // The chat being read stands for its own version; otherwise the one used last.
      if (!best || (best.id !== current.id && (chat.id === current.id || chat.updatedAt > best.updatedAt))) {
        shown.set(owner, chat);
      }
    }
    if (shown.size < 2) continue;

    const created = (owner: string, chat: FamilyChat) => byId.get(owner)?.createdAt ?? chat.createdAt;
    const ordered = [...shown.entries()].sort(
      ([a, ca], [b, cb]) => created(a, ca).getTime() - created(b, cb).getTime() || a.localeCompare(b),
    );
    const mine = ownerAt(current, seq, byId);
    out.set(seq, {
      index: ordered.findIndex(([owner]) => owner === mine),
      versions: ordered.map(([owner, chat]) => ({
        chatId: chat.id,
        createdAt: created(owner, chat).toISOString(),
      })),
    });
  }
  return out;
}
