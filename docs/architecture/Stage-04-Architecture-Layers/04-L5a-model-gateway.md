# ArcNave – Stage 4 · L5a Model Gateway – full audit
_2026-10-01 · Status: LOCKED (2026-10-01) · Source labels: Vendor (official doc) / Partial / ArcNave rec (no doc)_

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - Claude client = `AsyncAnthropicVertex` (`max_retries=0`, explicit deadlines); `count_tokens` free on Vertex incl. global; **Files API and URL sources unsupported on Vertex → inline base64 ≤30 MB**; **citations and `output_config.format` never in one request**; model lifecycle: Vertex retirement dates may differ from Anthropic's → pin ids, monitor Google notices (VS-29/VS-30, CVS1–8).

## Audit dimensions
1 Functional ops ✅ · 2 Provider behaviour ✅ (+GW18) · 3 Auth/identity (new) · 4 Quotas (new) · 5 Model lifecycle (new) · 6 Data governance/privacy (new) · 7 Runtime/SDK (new) · 8 Cost ✅ · 9 Observability ✅ · 10 Testing ✅ (G35)

## New items (continue L5-G numbering)
| # | Gap | Fact | Source | Rec |
|---|---|---|---|---|
| L5-G18 | **Claude sampling params** | temperature / top_p / top_k → **400 error** on Claude 4.7+ if non-default; Python SDK v1.0+ removed them → Gateway must NOT send them to Claude 5.5; L4-G45 applies to Gemini only | Vendor (Anthropic) | MVP – critical |
| L5-G19 | Auth & identity | Separate service accounts per deploy (API / Executor / Worker), least privilege; Claude models must be **enabled per model in Model Garden** (accept terms) | Partial (Google) + ArcNave | MVP |
| L5-G20 | **Quotas pre-launch** | Claude on Vertex has per-model QPM + input/output TPM (e.g., Opus 4.7 multi-region QPM 400, in-TPM 4M, out-TPM 400K; global ≈2× regional); gemini-embedding-001 5M input TPM regional; increases via console → check our 3 models + embeddings, request increases before launch | Vendor (Google) | MVP |
| L5-G21 | **Model lifecycle** | Gemini: auto-updated aliases vs stable versions; retirement announced when next stable ships; new access blocked 1 month before; after retirement 404. Claude: Google Cloud sets its own dates; Anthropic gives ≥60 days notice on its API (Sonnet 5.5 not before 28 Sep 2027, Opus 5.5 not before 22 Sep 2027) → pin exact versions, lifecycle registry with dates + alerts, migrate via G35/evals | Vendor (Google, Anthropic) | MVP |
| L5-G22 | **Data governance (Google)** | Google won't train on data without permission; **in-memory caching 24 h TTL ON by default** (disable per project, needs aiplatform.admin); abuse-monitoring prompt logging (exception can be requested); for ZDR: disable caching, request exception, disable request-response logging, avoid Google Search grounding. Partner (Claude) not covered by that page → Claude data handling "governed by Google Cloud" | Vendor (Google) | MVP decision (D-1) |
| L5-G23 | Request-response logging | Anthropic recommends enabling 30-day prompt/completion logging on Vertex to investigate misuse; conflicts with ZDR | Vendor (Anthropic) | MVP decision (D-2) |
| L5-G24 | Google Search grounding storage | Logs stored up to 3 days, cannot disable; alternative "Web Grounding for Enterprise" | Vendor (Google) | Stage 8 (web search choice) |
| L5-G25 | SDK client lifecycle | One async client per process, reused (connection pooling); explicit timeouts; Anthropic SDK retries 2× by default honoring retry-after → align with our retry matrix (avoid double retries) | Partial (Anthropic) + ArcNave | MVP |

## Open decisions (Gateway)
| ID | Question | Rec |
|---|---|---|
| S-1 | Claude cache TTL | 5 min chat; 1 h big stable blocks |
| S-3 | Gateway deployment | In-process Python module in API/Executor/Worker |
| D-1 | Disable Google in-memory caching (privacy) | Verify first whether it disables Gemini implicit context-cache discount; if not → disable |
| D-2 | Vertex request-response logging | OFF in MVP; our own audit logs without content; turn on short-term only for investigations |
| D-3 | Version pinning | Pin exact versions; no auto-updated aliases in production |

## Lock notes (user, 2026-10-01)
- G1 (prompt order) and G4 (company cache marker) MOVED to Context service. Gateway keeps G2, G3, G5–G25, CL1–CL12 (CL4 marker placement → Context).
- Decisions accepted: S-1, S-3, D-1, D-2, D-3 as recommended.
- System prompt ownership: text written in Stage 6 & stored versioned in L8 registry; version selected by L4; assembled/ordered by L5 Context; converted to provider format (Claude `system`, Gemini `system_instruction`) + cache breakpoints by Gateway.
