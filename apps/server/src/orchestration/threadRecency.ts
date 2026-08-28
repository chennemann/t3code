export const THREAD_REENGAGEMENT_WINDOW_MS = 36 * 60 * 60 * 1_000;

/**
 * Derives the stable sort anchor used by the current sidebar. A user message
 * advances the anchor only when it resumes a conversation after 36 hours of
 * user-message inactivity; assistant activity never changes it. Messages must
 * be provided oldest first, matching the projection repository's interface.
 */
export function deriveThreadUserMessageRecency(
  createdAt: string,
  messages: ReadonlyArray<{ readonly role: string; readonly createdAt: string }>,
): { readonly latestUserMessageAt: string | null; readonly recencyAnchorAt: string } {
  let recencyAnchorAt = createdAt;
  let latestUserMessageAt: string | null = null;
  let previousUserMessageAtMs: number | null = null;

  for (const message of messages) {
    if (message.role !== "user") continue;

    const messageAtMs = Date.parse(message.createdAt);
    if (!Number.isFinite(messageAtMs)) continue;

    latestUserMessageAt = message.createdAt;
    if (
      previousUserMessageAtMs !== null &&
      messageAtMs - previousUserMessageAtMs >= THREAD_REENGAGEMENT_WINDOW_MS
    ) {
      recencyAnchorAt = message.createdAt;
    }
    previousUserMessageAtMs = messageAtMs;
  }

  return { latestUserMessageAt, recencyAnchorAt };
}
