/**
 * Time to answer for tutor messages loaded from the server: from the
 * learner's question to the tutor's answer, as recorded (both messages carry
 * their creation time). Pure; used for answers given before this page was
 * opened — new answers are timed in the browser, until they are on screen.
 */
export function serverAnswerTimes(messages: { id: string; role: string; createdAt: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  let askedAt: number | null = null;
  for (const m of messages) {
    const at = Date.parse(m.createdAt);
    if (m.role === "USER") askedAt = at;
    else if (m.role === "ASSISTANT" && askedAt !== null && Number.isFinite(at)) {
      out[m.id] = Math.max(0, at - askedAt);
      askedAt = null;
    }
  }
  return out;
}
