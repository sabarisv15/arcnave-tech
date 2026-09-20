import type { Mode } from '../providers/types.js';

export interface RunPythonPolicyInput {
  prompt: string;
  mode: Mode;
  hasAttachments: boolean;
}

/**
 * Decides whether the model may even see run_python for this turn.
 *
 * This is intentionally conservative. The model can answer ordinary arithmetic itself, and
 * freshness questions belong to time/search capabilities. Python is reserved for explicit
 * code execution, substantial numerical work, or analysis of attached data.
 */
export function shouldExposeRunPython(input: RunPythonPolicyInput): boolean {
  const prompt = input.prompt.toLowerCase();

  const explicitPython =
    /\b(?:python|pandas|numpy|scipy|matplotlib|seaborn|jupyter)\b/.test(prompt) ||
    /\b(?:run|execute|debug|test)\s+(?:this\s+)?(?:code|script|program)\b/.test(prompt) ||
    /(?:\.py\b|```python)/.test(prompt);
  if (explicitPython) return true;

  const substantialComputation =
    /\b(?:regression|correlation|standard deviation|variance|confidence interval|monte carlo|simulation|linear algebra|matrix multiplication|numerical integration|numerical optimization|hypothesis test|statistical significance|time series|forecasting)\b/.test(
      prompt,
    );
  if (substantialComputation) return true;

  const attachedDataAnalysis =
    input.hasAttachments &&
    /\b(?:analy[sz]e|calculate|compute|clean|transform|aggregate|visuali[sz]e|plot|chart|summari[sz]e)\b/.test(
      prompt,
    ) &&
    /\b(?:data|dataset|csv|spreadsheet|excel|table|numbers|rows|columns|file|attachment)\b/.test(
      prompt,
    );

  return attachedDataAnalysis;
}
