# ArcNave – Stage 4 · L5.7 Safety Service – full audit
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01) · Labels: Vendor / Partial / ArcNave rec · Screen model (M9) + full policy → Stage 16_

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - SAF-3 revised: Model Armor now available in asia-south1 → inspect-only shadow trial (SD-8), never primary (Tamil/Hindi untested). M9 = Gemini 3.1 Flash-Lite structured verdict, pre-launch calibration (SD-7). Safety category list SF1 (SD-10). RV-2 concrete categories (SD-9). Red-team set SD-11. Crisis via separate rules detector + prompt.

## Contract
check_input(text, attachment_meta) · check_tool_output(content, source) · check_output(answer) → {allow | block | redact | flag, categories, scores}.

## Real-product / vendor evidence
- Anthropic: layered guardrails – lightweight-model harmlessness screen with structured verdict; input validation; values in system prompt; repeat offenders (warn/throttle/ban); untrusted content only in tool_result, JSON-encoded, source stated, no own instructions inside; least privilege + sandbox; screen tool outputs; continuous monitoring; red-team. Extra injection classifiers only for computer/browser use tools. Opus/Sonnet 5.5 refusal classifiers (stop_reason refusal).
- OpenAI: omni-moderation (text+image, 13 categories) free; "signals for your application's policy, not an automatic blocking decision".
- Google: Gemini safety filters default OFF (2.5 Flash+), thresholds settable; CSAM + PII/SPII not configurable; prompt block reason JAILBREAK. Model Armor: RAI + CSAM, injection/jailbreak, sensitive data, malicious URLs (≤256), docs ≤4 MB, images preview; inspect-only vs inspect-and-block; floor settings; US/EU multi-region; tested languages exclude Indian languages; works with Claude via REST; 2M tokens/month free then $0.10/M.
- Perplexity: no public detail on safety layer.

## Items
| # | Item | Source | Rec |
|---|---|---|---|
| SF1 | Lightweight-model screen, structured verdict (input + tool output) | Vendor (Anthropic) | MVP |
| SF2 | Indirect injection rules (CX3, T5, T6) | Vendor (Anthropic) | MVP |
| SF3 | Model Armor capability set | Vendor (Google) | SAF-3 |
| SF4 | Gemini thresholds explicit (default OFF) + JAILBREAK reason | Vendor (Google) | MVP (SAF-2) |
| SF5 | Repeat offenders | Vendor (Anthropic) | MVP (SAF-6) |
| SF6 | Red-team with injected docs/tool outputs before launch | Vendor (Anthropic) | MVP |
| SF7 | Continuous monitoring of flagged events | Vendor (Anthropic) | MVP |
| SF8 | Layered: platform filters + our screen + system-prompt policy | Vendor (Anthropic, Google) | MVP |
| SF9 | Classifier scores = signals; ArcNave policy decides | Vendor (OpenAI) | MVP principle |
| SF10 | Model Armor limits: US/EU, no Indian languages tested, $0.10/M after 2M free | Vendor (Google) | SAF-3 |
| SF11 | Screen model: Anthropic suggests small model (Haiku); we have Gemini 3.8 Flash; Flash-Lite verify | Vendor + ArcNave | Stage 16 (M9) |
| SF12 | Tanglish/code-mixed safety test set | ArcNave rec | MVP eval |
| SF13 | Non-switchable filters (Gemini CSAM/SPII, Claude refusal) → clear UI message | Vendor (Google, Anthropic) | MVP |
| SF14 | Untrusted-content policy text in system prompt | Vendor (Anthropic) | MVP (Stage 6) |
| SF15 | Crisis topics (self-harm): caring reply + Tele-MANAS 14416 | ArcNave rec | MVP (SAF-5) |
| SF16 | Safety event log + ops review queue | ArcNave rec + Anthropic monitoring | MVP |
| SF17 | Wrong-block report via feedback (L1 G6) → ops review | ArcNave rec | MVP |
| SF18 | Latency budget: blocking checks very fast; model screen parallel | ArcNave rec (fast reply) | MVP (SAF-1) |
| SF19 | PII in prompts: no blocking in MVP (B2B data expected); DLP later; never log raw text openly (Stage 17) | ArcNave rec | SAF-7 |
| SF20 | Company-specific blocked topics | ArcNave rec | Later |
| SF21 | India legal check (IT Rules, DPDP, grievance contact) | ArcNave rec | Stage 16 |

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CSF1 | Opus/Sonnet 5.5 refusal classifiers; mid-stream refusal → discard + fallback (C11/C12) | MVP (locked L4) |
| CSF2 | Anthropic guardrail checklist (SF1, SF2, SF5–SF8, SF14) | MVP |
| CSF3 | Anthropic's extra injection classifiers only for computer/browser use → our own tool-output screen needed | MVP |
| CSF4 | If Claude used as screen: structured outputs denied by default by GCP org policy → allow first | Config |

## Decisions
| ID | Question | Rec |
|---|---|---|
| SAF-1 (L-5) | Safety mode vs speed | Cheap rules block instantly; model screen runs in parallel with answer; flagged → stop + retract |
| SAF-2 (S-2) | Gemini thresholds | BLOCK_MEDIUM_AND_ABOVE, all 4 categories |
| SAF-3 (SF-1) | Model Armor | Not MVP main screen (US/EU, no Indian languages); own Gemini screen; Model Armor inspect-only trial later |
| SAF-4 | Output check | Provider filters + Claude refusal live; our output scan async (log/flag, retract if severe) |
| SAF-5 | Crisis topics | Caring reply + Tele-MANAS 14416 via system prompt |
| SAF-6 | Repeat offenders | Warn → throttle → ops review; no auto-ban in MVP |
| SAF-7 | PII | No blocking MVP; DLP later |
