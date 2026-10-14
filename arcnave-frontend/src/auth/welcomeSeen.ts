/**
 * "Shown once per user" for the first-sign-in welcome (board S4-Welcome).
 *
 * The mark is kept per user id in this browser (localStorage, through the try/catch-safe helpers in
 * storage.ts). With storage blocked the welcome still shows once per page session, because the
 * session provider clears its own "new account" flag when the welcome closes.
 */
import { readLocal, writeLocal } from "../storage";

const key = (userId: string) => `welcome-seen:${userId}`;

export function hasSeenWelcome(userId: string): boolean {
  return readLocal(key(userId)) === "1";
}

export function markWelcomeSeen(userId: string): void {
  writeLocal(key(userId), "1");
}
