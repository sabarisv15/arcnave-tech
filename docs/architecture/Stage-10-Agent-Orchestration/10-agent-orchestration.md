# ArcNave – Stage 10 · Agent / workflow orchestration – DRAFT
_2026-10-02 · Source: GPT Astra (10-astra-prompt.md; official docs, checked 2 Oct 2026) + locked inputs · Status: DRAFT – decisions need user OK_

Labels: ✅ Vendor documented · ⚠️ Partial · 📄 Official blog · 🔧 ArcNave design

## 0. Already locked (inputs)
O-1 own thin runner · O-2 Fast/Normal/Deep 1–2/5/15 steps, 10 min · O-3 Turn Executor via Cloud Tasks + checkpoints (R14) · L4 G1–G63 (timeouts, retry/fallback, tool idempotency, context growth guard G46, kill switch) · TL-3 read-only external tools · D4 keep partial on Stop · FD-1 no 2nd message during running turn · D3 mobile resume · L1 push notifications later · RT-4 effort Fast low / Normal medium / Deep high · CXD-4 whole-document tasks → batch map-reduce job · Stage 9 D1 Send blocked until file ready.

## 1. Real-product evidence
| | Claude | ChatGPT | Gemini app | Perplexity |
|---|---|---|---|---|
| Research mode | Research (paid); 📄 5–15 min, up to 45 | Deep research; 📄 5–30 min | Deep Research ~5–10 min ✅ | Research: dozens of searches, ~3–5 min ✅ |
| Plan before start | ❌ | Plan, user can review/modify ✅ | Plan, **Edit plan → Start research** ✅ | Refines own plan; no approval ❌ |
| Live progress | Action summaries (files) ⚠️ | Live progress + activity history ✅ | Notify when ready ❌ live | Live sources + findings ✅ |
| Clarify | ❌ | May ask **before** start ✅ | ❌ | Asks **before** broad queries ✅ |
| Background + notify | Projects Code beta continues ⚠️ | 📄 notification when done | Leave chat; web in-app / mobile push ✅ | ❌ |
| Stop / steer | Stop file actions ✅ | Interrupt to refine ✅ | Pre-run plan edit only | Follow-up input while running ✅ |
| Limits | Plan usage, 5-h session reset ✅ | Remaining tasks shown, monthly reset ✅ | Daily research requests, remaining shown ✅ | Ent Pro 50 Research/month, Max 500 ✅ |
| Whole document | Advises dividing large docs ✅ | 2M tokens/file admission | Large context can miss details ✅ | Long files → important parts ✅ |
| **Send while file processing (A9)** | ❌ | ❌ | ❌ | ❌ |
**Pattern:** research modes run minutes, show progress, clarify before (not during), plan editable on ChatGPT/Gemini, quotas with "remaining" counter. Nobody guarantees exhaustive whole-file coverage. Nobody documents Send-gating → **D1 stays (a)**.

## 2. Vendor tech facts
**Claude (Vertex)**
- Context editing: Google Cloud **Beta**. Compaction: Google Cloud **Beta** (signed block must be kept exactly; can't combine with context_management). Memory tool: stable, client-side. Task budgets: beta, advisory, Vertex status ❌.
- Sonnet 5.5: medium for well-specified multi-step, high for harder/longer; low effort → premature check-ins → prompt "continue until done, ask only when needed or before a risky step". xhigh/max may launch reviewer sub-agents; between_tools rejected at xhigh/max.
- Opus 5.5: default medium; **end_turn is not proof the task is done**.
- Parallel tool calls for independent ops; sub-agents only where isolated contexts help.
- Effort change breaks prompt cache.
**Gemini (Vertex)**
- Deep Research / Interactions: **Preview, global only, 7-day storage (cannot disable), not for production** → not usable.
- Agent Runtime (ex-Agent Engine): GA, **asia-south1 supported**, sessions + Memory Bank GA, long ops up to 7 days. (Not adopted – O-1 own runner; Memory Bank → Stage 11.)
- No hard max function calls per turn; keep thought signatures in original parts; HIGH thinking for complex multi-step.
- Long context: put everything in context when it fits; multi-needle accuracy drops; no official map-reduce recipe.
**OpenAI patterns**: background mode (poll, idempotent cancel, sequence_number resume); RunState serialize for approvals; tracing default ON with replaceable exporter.
**Durable execution**
- Cloud Tasks HTTP: deadline 15 s–30 min; worker may keep running after deadline/delete → **cooperative cancel needed**.
- Cloud Run jobs: task timeout up to 168 h, retries 0–10 (default 3), cancel execution.
- Workflows: 1 year, 100k steps, 512 KB vars, callbacks, Mumbai, $0.01/1k internal steps.
- LangGraph: MIT, Postgres checkpointer, interrupts (node restarts → idempotent side effects).
- Map-reduce: LangChain map_reduce deprecated; LlamaIndex tree_summarize; **no coverage guarantee** anywhere.

## 3. Gaps
| # | Gap | Label | MVP / Later |
|---|---|---|---|
| AG1 | Completion check before final answer: requested deliverables exist (artifact made, all sub-questions answered) – Opus end_turn ≠ done | ✅ Anthropic | MVP |
| AG2 | Cooperative cancel: Stop sets DB flag; executor checks between steps + inside long tools; Cloud Tasks/jobs don't kill workers | ✅ GCP | MVP |
| AG3 | Live step list (activity) from tool status labels (TD-10) + sources | ✅ pattern | MVP |
| AG4 | Clarify before starting long/ambiguous tasks only; max one round; not mid-task | ✅ pattern + Anthropic | MVP |
| AG5 | Done notification when user is in another chat: in-app MVP; push Later (L1) | ✅ Gemini | MVP in-app |
| AG6 | Whole-document job: map every chunk/page, reduce, coverage report ("1,000/1,000 pages"); list-all = extract per chunk + merge + dedupe | ✅ no vendor guarantee → 🔧 | MVP |
| AG7 | Work >10 min (whole-doc jobs, future research) → Cloud Run job with checkpoints, not one Cloud Tasks dispatch | ✅ GCP | MVP |
| AG8 | Per-company quota for Deep/long tasks + "remaining" counter | ✅ pattern | MVP (numbers Stage 18) |
| AG9 | Partial results of stopped long job saved (extends D4) | 🔧 | MVP |
| AG10 | Never xhigh/max effort (reviewer sub-agents, between_tools 400) | ✅ Anthropic | MVP |
| AG11 | Claude context editing / compaction betas not used; own context guard (G46) + tool result caps (TD-6) | ✅ Beta | MVP rule |
| AG12 | Prompt rule: continue until done, ask only when blocked (Sonnet low-effort check-ins) | ✅ Anthropic | MVP |
| AG13 | Steering mid-task (add input while running) | ✅ ChatGPT/Perplexity | Later (FD-1) |
| AG14 | Editable plan + approval | ✅ ChatGPT/Gemini | Later (with Research mode) |
| AG15 | Sub-agents / multi-agent | ✅ Anthropic | Later |
| AG16 | Gemini Deep Research / Interactions not usable (preview, no production, global storage) | ✅ | Fact |
| AG17 | Traces stored in India (own exporter) | ✅ OpenAI pattern | Stage 17 |

## 4. Claude-only
| # | Fact → impact |
|---|---|
| CO1 | Context editing + compaction = Beta on Google Cloud; compaction block signed, keep exact → not MVP |
| CO2 | Memory tool stable, client-side → our storage (Stage 11) |
| CO3 | Task budgets advisory, Vertex unknown → our executor enforces steps/time/cost |
| CO4 | Sonnet low effort = premature check-ins → AG12 prompt rule |
| CO5 | Opus end_turn ≠ done → AG1 |
| CO6 | xhigh/max → reviewer sub-agents + between_tools 400 → AG10 |
| CO7 | Effort change breaks cache; per-message effort beta → effort fixed per turn |

## 5. Decisions (recommendations – need OK)
| ID | Decision | Rec |
|---|---|---|
| **AO-1** | Research mode (10–30 min, many searches, report) | **Later** (Phase 2). MVP Deep profile = single agent, 15 steps, 10 min. Slots built now: job runtime (AG7), progress (AG3), notify (AG5), quotas (AG8) |
| AO-2 | Plan display | MVP live step list; editable plan Later with Research mode |
| AO-3 | Clarifying questions | Before start only, one round, only if key input missing |
| AO-4 | Runtime | ≤10 min turns: Turn Executor (locked). >10 min: Cloud Run job + checkpoints. Workflows Later (approvals/callbacks). LangGraph no (reference only) |
| AO-5 | Cancel | Cooperative flag + partial results kept |
| AO-6 | Whole-document | Own map-reduce with coverage %; map on Gemini Flash, reduce on selected model |
| AO-7 | Notifications | In-app MVP; push Later |
| AO-8 | Claude betas (context editing, compaction, task budgets) | Not in MVP |
| AO-9 | Sub-agents | Later |
| AO-10 | Completion check | MVP |
| AO-11 | Long-task quotas + remaining counter | MVP, numbers Stage 18 |
| AO-12 | D1 Send-gating | No vendor evidence → stays (a) |

## 6. LV-1 additions
1. Cooperative cancel latency (Stop → executor stops ≤2 s).
2. Map-reduce on 1,000-page PDF: time, cost, coverage on Cloud Run job.
3. Sonnet 5.5 medium vs high on 15-step tasks (premature check-ins).
4. Gemini 3.8 Flash HIGH thinking with 15 sequential tool calls + thought signatures.

## 7. Confidence
Product patterns Medium-High (help docs; durations from blogs). Vendor tech High. Recommendations High for MVP scope; Research-mode timing is a product choice.

## 8. Sources
support.claude.com 11088861, 9517075, 12111783, 8241126, 12429409 · anthropic.com/news/integrations · help.openai.com 10500283, 6825453, 11481834, 11752874, 8555545 · openai.com/index/introducing-deep-research · support.google.com/gemini 15719111, 16275805, 14903178 · perplexity.ai/help-center 10352903, 10738684, 12528830, 13600190, 11187416, 10354807 · platform.claude.com: build-with-claude/overview, context-editing, compaction-on-demand, memory-tool, task-budgets, prompting best practices, prompting-claude-sonnet-5-5, prompting-claude-opus-5-5 · docs.cloud.google.com gemini-enterprise-agent-platform: interactions, zero-data-retention, use-deep-research, build/runtime, sessions, memory-bank, agent-locations, function-calling, thought-signatures, thinking, long-context · cloud.google.com agent platform pricing, workflows pricing · developers.openai.com background, deep-research · openai.github.io/openai-agents-python (human_in_the_loop, running_agents, tracing) · docs.langchain.com langgraph persistence/interrupts · github langchain-ai/langgraph, langchain map_reduce/reduce · developers.llamaindex.ai response synthesizers · docs.cloud.google.com workflows quotas/callbacks/locations/overview/cancel, tasks REST, run task-timeout/max-retries/jobs.
