# ArcNave – Stage 10b · Research mode (MVP, provisional) – DRAFT
_2026-10-02 · User decision: AO-1 = Research mode in MVP; build → test (Stage 21) → cost (Stage 18) → final keep/limit decision. Revises 10-agent-orchestration.md AO-1, AO-2, AO-9, AG14, AG15._

## Evidence used (saved facts)
- Anthropic multi-agent research (official blog): lead agent plans, parallel sub-agents search, lead synthesises, citation step; effort scaling 1 agent 3–10 calls / 2–4 sub-agents / 10+; ~15× chat tokens; up to 90% faster; checkpoint + resume.
- OpenAI deep research API: clarify → rewrite prompt → research in background mode.
- ChatGPT / Gemini: editable plan before start; Gemini "Edit plan → Start research", notify when ready.
- Perplexity: clarify before broad queries; dozens of searches; live progress.
- Usage is occasional: Perplexity Free 1/month, Ent Pro 50/month; ChatGPT Edu 5/day; Gemini daily limit.

## Flow
1. **Clarify** – at most one round, only if key info missing.
2. **Plan** – topic list shown; user can edit, then Start.
3. **Parallel search** – 3–5 sub-agents, one topic each: web search + fetch + user's files (file_search).
4. **Notes** – each sub-agent saves findings + sources to DB (checkpoint).
5. **Report** – lead model writes report artifact (docx / PDF) + short chat summary with citations.
6. **Check** – every claim has a source id; missing → flagged or removed.
7. **Notify** – in-app when done; runs in background (user can leave chat).

## Decisions (recommendations – need OK)
| ID | Decision | Rec |
|---|---|---|
| RS-1 | Flow | As above (clarify → editable plan → parallel sub-agents → report → check → notify) |
| RS-2 | Models | Provider-consistent: **Gemini research** = Gemini Flash sub-agents (our grounding search) + Gemini lead; **Claude research** = Sonnet sub-agents with native web_search + Sonnet/Opus lead. Never pass Google-grounded results to Claude (TD-2b) |
| RS-3 | Limits per run | Max 30 min, ~50 searches, 5 sub-agents (tune after test) |
| RS-4 | Company quota | Monthly research quota + "remaining" counter; numbers after Stage 18 cost |
| RS-5 | Runtime | Cloud Run job + checkpoints; cooperative cancel; Stop → partial report saved |
| RS-6 | Sources | Web + user's chat/project files |
| RS-7 | Admin switch | Company admin can turn Research ON/OFF (like web search TL-2); needs web search ON |
| RS-8 | Final call | Keep / limit / move to paid add-on after Stage 21 test + Stage 18 cost |

## Changes to Stage 10 draft
- AO-1 → MVP (provisional).
- AG14 editable plan → MVP (research mode only).
- AG15 sub-agents → MVP (research mode only); normal chat stays single agent.
- AO-7 notify: in-app MVP; push still Later (L1).

## LV-1 / Stage 21 tests
Research quality on 20 Indian business questions (Gemini vs Claude), time per run, searches per run, tokens per run, report citation accuracy.
