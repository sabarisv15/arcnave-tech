import { coolingAnswer, sources } from "./fixtures";
import type {
  ErrorCode,
  Mode,
  ResearchEvent,
  Source,
  ResearchStage,
} from "./types";
export type AdapterEvent =
  | { type: "research"; event: ResearchEvent }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; questions: string[] }
  | { type: "error"; code: ErrorCode };
export interface GenerateRequest {
  prompt: string;
  mode: Mode;
  model: string;
  scope: string;
  context?: string;
  fault?: ErrorCode | "partial";
}
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
export function responseFor(req: GenerateRequest) {
  const p = req.prompt.toLowerCase();
  if (req.mode !== "chat") {
    if (
      /cool|heat|canopy|roof|shade|neighborhood|cities/.test(p) &&
      req.scope === "All sources"
    )
      return {
        text: coolingAnswer,
        refs: sources,
        questions: [
          "Compare tree canopy and cool roofs",
          "What should a neighborhood cooling pilot measure?",
          "Turn these findings into a project brief",
        ],
      };
    const refs = /cool|heat|canopy|roof|cities/.test(p)
      ? sources.filter((s) => s.type === req.scope)
      : [];
    return {
      text: `## A research starting point\n\nYour question: **${req.prompt.replace(/[*<>]/g, "")}**\n\nThis workspace uses a demonstration adapter. It has not searched the web for this question. ${refs.length ? "The reference list contains saved examples that match your source filter, not newly retrieved evidence." : "No supporting sources are available for this question in the demo collection."}\n\n### A useful investigation would\n\n1. Define the comparison and the outcome that matters.\n2. Find primary material and record publication dates.\n3. Compare supporting and opposing evidence.\n4. Separate established findings from open questions.\n\nYou can edit the question, change the source scope, or try the urban-cooling example to explore the full citation experience.`,
      refs,
      questions: [
        `What evidence would help answer “${req.prompt.slice(0, 65)}”?`,
        "How can cities stay cooler?",
      ],
    };
  }
  if (/essay|write|draft|story/.test(p))
    return {
      text: `## A place to start\n\nHere is an illustrative opening you can shape in your own voice:\n\n> There are days when the smallest things ask us to pay attention. A familiar street in different light. A sentence we return to. A question that stays a little longer than expected.\n\nBuild outward from one specific detail. Let the reader see what you saw before explaining what it means.\n\n**For your next draft:** choose one scene, one change, and one thing left unsaid.\n\n*This is a sample writing response. A live model is not connected.*`,
      refs: [],
      questions: [],
    };
  if (/code|function|javascript/.test(p))
    return {
      text: 'Here is a small, self-contained example you can adapt:\n\n```javascript\nfunction uniqueBy(items, key) {\n  return [...new Map(items.map(item => [item[key], item])).values()];\n}\n\nconst result = uniqueBy([{ id: 1 }, { id: 1 }], "id");\n```\n\nThe map keeps one value per key. Later entries replace earlier entries with the same key.\n\n*Demonstration response; no code was executed.*',
      refs: [],
      questions: [],
    };
  return {
    text: `Let’s give that thought a little structure.\n\nYou’re exploring **${req.prompt.replace(/[*<>]/g, "")}**.\n\nStart with the outcome: what would a useful answer help you understand or do? Then separate what you already know from what still needs evidence.\n\n- **Clarify the question.** Keep one main decision in view.\n- **Make it concrete.** Bring an example, a constraint, or a first draft.\n- **Choose the next step.** A small test often teaches more than a perfect plan.\n\n${req.context ? "This conversation includes your project’s saved context.\n\n" : ""}*This is a demonstration response. For a sourced example, ask how cities can stay cooler in Search or Research mode.*`,
    refs: [],
    questions: [],
  };
}
/** Replace this generator with server SSE events. All visible progress comes from this boundary. */
export async function* generate(
  req: GenerateRequest,
  signal: AbortSignal,
): AsyncGenerator<AdapterEvent> {
  await delay(350, signal);
  if (req.fault && req.fault !== "partial") {
    yield { type: "error", code: req.fault };
    return;
  }
  const result = responseFor(req);
  if (req.mode !== "chat") {
    const steps: [ResearchStage, string, string][] = [
      [
        "planning",
        "Preparing demo response",
        "This is a local demonstration; no live web search is running.",
      ],
      [
        "reading",
        `Loading ${result.refs.length} saved reference records`,
        "The frontend is loading its curated example collection.",
      ],
    ];
    for (const [stage, label, detail] of steps) {
      yield {
        type: "research",
        event: { stage, label, detail, at: Date.now() },
      };
      await delay(req.mode === "research" ? 650 : 200, signal);
    }
    yield {
      type: "sources",
      sources: result.refs.map((s, i) => ({
        ...s,
        unavailable: req.fault === "partial" && i === 1,
      })),
    };
  }
  for (const text of result.text.match(/.{1,36}(?:\s|$)|.{1,36}/gs) || []) {
    await delay(
      req.model === "Gemini 3.8 Flash" ? 10 : req.model === "Opus 5" ? 110 : 40,
      signal,
    );
    yield { type: "delta", text };
  }
  if (req.mode !== "chat")
    yield {
      type: "research",
      event: {
        stage: req.fault === "partial" ? "partial" : "complete",
        label:
          req.fault === "partial"
            ? "Example ready with an unavailable source"
            : "Example response ready",
        detail:
          "Saved reference metadata and prepared text have loaded. No live investigation was performed.",
        at: Date.now(),
      },
    };
  yield { type: "done", questions: result.questions };
}
export const errors: Record<ErrorCode, { title: string; detail: string }> = {
  network: {
    title: "Connection interrupted",
    detail: "Your message is saved. Check your connection, then retry.",
  },
  generation: {
    title: "The response could not finish",
    detail: "You can retry this response or edit your question.",
  },
  research: {
    title: "Research could not finish",
    detail: "Any loaded references are still available. Retry or use Search.",
  },
  session: {
    title: "Session expired",
    detail: "This is a simulated session error. Retry to continue the demo.",
  },
  model: {
    title: "This model is unavailable",
    detail: "Choose Auto or try again in a moment.",
  },
  "rate-limit": {
    title: "Too many requests",
    detail: "This is a simulated rate limit. Retry when you are ready.",
  },
};
