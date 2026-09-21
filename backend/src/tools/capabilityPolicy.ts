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
export interface RunPythonPolicyInput {
  prompt: string;
  mode: Mode;
  hasAttachments: boolean;
  attachmentMimeTypes?: string[];
}

export interface RunPythonDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Decides whether the model may even see run_python for this turn.
 *
 * Python is strictly reserved for:
 * 1. Explicit code execution / debugging ('run python', 'execute script', 'pandas', etc.)
 * 2. Substantial computational mathematics / statistics (regression, monte carlo, etc.)
 * 3. Genuine structured tabular/numerical data analysis on attached datasets (CSV, Excel, TSV).
 *
 * Explicitly excluded:
 * - Web search and Deep Research modes.
 * - Ordinary conversational chat and simple questions.
 * - General document/image/audio/video analysis and summaries.
 * - Artifact drafting and markdown generation.
 */
export function evaluateRunPythonPolicy(input: RunPythonPolicyInput): RunPythonDecision {
  const prompt = input.prompt.toLowerCase().trim();

  // Tier 1: Exclude purely explanatory/conceptual requests that do NOT ask for code execution or computation
  const isPurelyExplanatory =
    /\b(?:explain|what is|what are|how does|define|history of|overview of|theory behind|describe)\b/.test(
      prompt,
    ) &&
    !/\b(?:run|execute|calculate|compute|plot|graph|chart|regress|simulate|verify with code|debug|implement)\b/.test(
      prompt,
    );
  if (isPurelyExplanatory) {
    return {
      allowed: false,
      reason: 'Explanatory and conceptual queries do not require Python execution.',
    };
  }

  // Exclude artifact-only drafting requests
  const isArtifactDrafting =
    /\b(?:create|draft|write|generate)\s+(?:an?\s+)?(?:artifact|document|report|essay|letter|article|outline)\b/.test(
      prompt,
    ) && !/\b(?:python|code|script|pandas|numpy|calculate|compute)\b/.test(prompt);
  if (isArtifactDrafting) {
    return {
      allowed: false,
      reason: 'Artifact drafting and document creation exclude Python execution.',
    };
  }

  // 1. Explicit code execution
  const explicitPython =
    /\b(?:python|pandas|numpy|scipy|matplotlib|seaborn|jupyter|statsmodels|scikit-learn|sklearn)\b/.test(
      prompt,
    ) ||
    /\b(?:run|execute|debug|eval|evaluate|test)\s+(?:this\s+)?(?:python|code|script|program|snippet)\b/.test(
      prompt,
    ) ||
    /(?:\.py\b|```python)/.test(prompt);
  if (explicitPython) {
    return {
      allowed: true,
      reason: 'Explicit Python or code execution request detected.',
    };
  }

  // 2. Substantial computational mathematics
  const substantialComputation =
    /\b(?:linear regression|logistic regression|correlation matrix|standard deviation|variance calculation|confidence interval|monte carlo|numerical simulation|eigenvalues|matrix multiplication|numerical integration|numerical optimization|hypothesis test|p-value|statistical significance|arima|time series forecasting)\b/.test(
      prompt,
    );
  if (substantialComputation) {
    return {
      allowed: true,
      reason: 'Substantial numerical computation or statistical modeling requested.',
    };
  }

  // 3. Genuine tabular/spreadsheet attached data analysis
  if (input.hasAttachments) {
    const tabularMimes = new Set([
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/tab-separated-values',
    ]);
    const hasTabularAttachment =
      input.attachmentMimeTypes && input.attachmentMimeTypes.some((m) => tabularMimes.has(m));

    const mentionsTabularData =
      /\b(?:csv|spreadsheet|excel|\.xlsx?|dataset|tabular data|columns?|rows?|dataframe)\b/.test(
        prompt,
      );

    const computationalVerb =
      /\b(?:analy[sz]e|calculate|compute|aggregate|clean|transform|regress|correlate|quantify|plot|chart|graph|distribution)\b/.test(
        prompt,
      );

    if ((hasTabularAttachment || mentionsTabularData) && computationalVerb) {
      return {
        allowed: true,
        reason: 'Genuine tabular/spreadsheet data analysis requested with computational operations.',
      };
    }
  }

  return {
    allowed: false,
    reason: 'Ordinary chat, qualitative queries, and non-computational tasks exclude Python.',
  };
}

export function shouldExposeRunPython(input: RunPythonPolicyInput): boolean {
  return evaluateRunPythonPolicy(input).allowed;
}

