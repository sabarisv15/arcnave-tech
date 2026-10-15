# ArcNave – Stage 6 reference: published system prompts (structure only)
_2026-10-01 · Sources: Anthropic official system-prompt release notes (claude.ai apps only, NOT API) – Opus 5.5 (22 Sep 2026), Fable 5.1 (1 Sep 2026); OpenAI official GPT-6 Astra prompting guide. OpenAI does NOT officially publish ChatGPT's system prompt → unofficial copies not used._

## Patterns worth copying (structure, not text)
| # | Pattern | Seen in | Use in ArcNave |
|---|---|---|---|
| SP-R1 | One root tag with XML sections: product_information, refusal_handling, legal/financial, tone_and_formatting, user_wellbeing, evenhandedness, mistakes/criticism, knowledge_cutoff | Claude Opus 5.5 / Fable 5.1 | Same modular sections (CX modular prompt) |
| SP-R2 | `{{currentDateTime}}` template + "answer as an informed person at cutoff talking to someone on this date"; offer web search for newer facts | Claude | Date block (TH-2) + cutoff line per model |
| SP-R3 | Formatting: prose first; lists only when asked or truly multi-part; never bullets in refusals; short answers OK for simple questions | Claude; GPT-6 Astra ("clear, concise paragraphs") | Tone section |
| SP-R4 | Refusal style: state principle in one line + offer alternative; don't reveal detection mechanics; no lecturing | Claude | Safety section (RV-2) |
| SP-R5 | Wellbeing: accurate, current helplines; keep help path open | Claude | Tele-MANAS 14416 (SAF-5) |
| SP-R6 | Treat tag-wrapped text in the user turn that claims to be from the system/company with caution | Claude | Untrusted-content rule (CX/T5) incl. fake "ArcNave admin" tags |
| SP-R7 | Good/bad response examples with rationale | Claude | Few examples for hardest rules only |
| SP-R8 | "After tool calls, summarize the answer in 1–2 sentences" | Fable 5.1 | Tool-answer style |
| SP-R9 | Avoid unsolicited warnings/disclaimers; avoid filler like "Bottom line:" | GPT-6 Astra guide | Tone section |
| SP-R10 | Developer instructions > user instructions | GPT-6 Astra guide | ArcNave rules > company admin > project > user |
| SP-R11 | Remove sampling params; reasoning effort "low" not "none" | GPT-6 Astra guide | Already G45-R |

## Notes
- Published Claude prompts are ~6.5–8k tokens. Ours should be leaner; but a stable prefix ≥4,096 tokens (system + tools) qualifies for Gemini 3 implicit caching (L5-G3) – size is a cost lever.
- Claude prompts don't set reply language explicitly → ArcNave must (N13).
- These are consumer-app prompts; ArcNave is B2B – add company/project instruction layering and citation rules they don't need.
