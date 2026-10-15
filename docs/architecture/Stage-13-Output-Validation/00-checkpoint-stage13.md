# ArcNave – Checkpoint · Stage 13 Output validation – LOCKED 2026-10-03
_User OK 2026-10-03 (VD-1…VD-12 as recommended). Final word over 13-output-validation.md (draft). Evidence: 13-astra-results.md._

> **Doc-sync 2026-10-03 (Stage 17) – see Stage-17-Observability/00-checkpoint-stage17.md:**
> - validation_result stores numeric/categorical results only; **judge explanations are not stored**. Google managed online evaluation not used (requires prompt/response content) (OD-14). Validation actions exported as metrics without content.

> **Doc-sync 2026-10-03 (Stage 18) – see Stage-18-Cost-Performance/00-checkpoint-stage18.md + 00-Handoff/00-cost-decision-log.md:**
> - Judge sampling stays **synchronous** (Stage 18 CD-6 withdrawn – batch would save only ₹0.8/user/day). Gemini batch used only for offline jobs (embedding backfill, map-reduce, memory consolidation).

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - Claude: citation-bearing turns and structured-output (`output_config.format`) turns are separate requests (incompatible in one request) (VS-30).

## Docs
| Doc | What |
|---|---|
| 13-astra-prompt.md / 13-astra-results.md | Research prompt + Astra answers (Parts 0, A–N; 24 NOT FOUND items) |
| 13-output-validation.md | Evidence table, facts F1–F20, gaps OV1–OV26, Claude-only COV1–COV8, decisions VD-1–VD-12, cost note, LV-1, doc-sync debt |

## Locked decisions (one line each)
- **Three release points:** RP-1 live (provider signals + cheap checks) · RP-2 before show/act (JSON, tool args, artifacts) · RP-3 after done (async: citations, claim support, completion, leak, sampling) → annotate / regenerate / retract.
- **VD-1 grounding engine = C:** LLM judge on Gemini 3.1 Flash-Lite, async, only on answers that used files/web; Vertex Check Grounding = Stage 21 bake-off (English) + fallback; English-only open checkers not used.
- **VD-2 low support:** annotate (generic "verify" note + weak-citation marks); Deep = one regenerate with findings; never silent edits.
- **VD-3 truncation:** Normal/Deep one auto-continue, else "cut short" notice + Continue button; Fast notice only; structured output cut = failure.
- **VD-4:** structured-output post-check always (schema, case-insensitive enums, refusal/max_tokens = failure, Gemini silent-ignore guard); 1 reask with error (Fast 0).
- **VD-5 retract = fixed list only:** provider block/refusal mid-stream, other-tenant/unknown citation id, system-prompt canary / internal tag / secret in output, severe safety verdict.
- **VD-6 completion check:** deterministic always (promised artifact vs tool success, ids resolved, format present); Flash-Lite check only on Normal/Deep turns with tools or multi-part requests; missing → one more step inside budget.
- **VD-7 artifact gate:** reopen (docx/pptx/xlsx) + LibreOffice render test + xlsx recalc/error scan + qpdf/pypdf strict; web page = own HTML allowlist + CSP; chart = ECharts JSON schema + data check; 1 repair; Nu validator / Playwright = Later.
- **VD-8 numbers reconciliation:** run_code/DuckDB typed values vs numbers in answer → annotate "verify numbers"; Deep repair.
- **VD-9 language check:** log only in MVP (LANG-1); action decided Stage 21.
- **VD-10:** canary + secret + internal-tag scan MVP (sync); PII/DLP scan of outputs Later (SAF-7).
- **VD-11:** ~10% online LLM-judge sampling (rate Stage 18) → Stage 17 dashboards, Stage 21 calibration.
- **VD-12 per-profile budgets:** Fast deterministic only; Normal + judge/completion; Deep + regenerate.
- Finish-code map v2 (new Gemini reasons, pause_turn, message_delta rule); recitation = keep partial + notice + regenerate, no provider fallback; buffered tool-input streaming; thinking never validated; citation integrity = 4 verdicts (pointer MVP, quote MVP, claim MVP async, coverage Later); research report citation check pre-publish (OV12); `validation_result` table ids/hashes only.

## Cost note (Stage 18 confirms)
Flash-Lite judge ≈ ₹0.12 per checked answer (≈₹2.7k/month at 50 users if 30% of turns use files/web; ≈₹2.7 lakh at 5,000 → sampling decision for Normal in Stage 18). Check Grounding ≈ ₹0.6 per check. Completion check ≈ ₹0.05. Deterministic checks ≈ ₹0.

## LV-1 additions → 00-lv1-register.md LV-62…LV-67
## Doc-sync → applied 2026-10-03 (see 00-doc-sync-register.md "Stage 13")
## Next: Stage 14 Streaming / rendering (client rendering + two admin consoles; transport already locked in Stage 5 F3).
