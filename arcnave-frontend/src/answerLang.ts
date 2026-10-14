/**
 * "ta" when an answer is written mostly in Tamil script, so it can carry `lang="ta"`: the
 * answer then takes the Tamil answer type from Final-Chat-Light (`.lk .ans.ta`: Noto Serif
 * Tamil, weight 500, 30 px lines) and screen readers read it with a Tamil voice. Tanglish (Tamil
 * in Latin letters) is English text and stays unmarked. The share is ours: more than a third of
 * the letters, so a Tamil word quoted in an English answer does not flip the whole answer.
 */
export function answerLang(text: string): "ta" | undefined {
  const tamil = text.match(/[஀-௿]/g)?.length ?? 0;
  if (!tamil) return undefined;
  const others = text.match(/[^\P{L}஀-௿]/gu)?.length ?? 0;
  return tamil / (tamil + others) > 1 / 3 ? "ta" : undefined;
}
