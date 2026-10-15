# ArcNave – Checkpoint: Stage 7 (Model routing) – LOCKED 2026-10-02
_Read with 00-checkpoint-stage6.md. Next: Stage 8 (Tool execution)._

## Doc
07-model-routing.md – evidence, gaps MR1–MR19, Claude-only CR1–CR8, decisions RT-1–RT-10, 7.9 capability matrix, 7.10 model role registry, 7.11 Claude budget mechanics, 7.12 fallback matrix, 7.13 regenerate, 7.14 model upgrade process.

## Key decisions
- Auto MVP = rules only (input type, size/pages, profile, Claude switch, Claude budget) → Gemini 3.8 Flash; router reads file metadata only; Flash-Lite classifier later.
- Effort: Fast low / Normal medium / Deep high (always explicit; Sonnet API default is high); xhigh/max off.
- Model label on every answer (+ Auto / fallback note).
- Per-company monthly Claude limit set by ArcNave team (replaces Stage 1 "₹1,000/month total"); 80% admin alert; 100% → Gemini + message; monthly reset.
- Fallback: Gemini → Sonnet (if allowed) · Sonnet → Gemini · Opus → Sonnet → Gemini; no fallback for harmful refusals or Gemini safety blocks.
- Model role registry M1–M11 in config; exact version pins; upgrade = eval → canary → rollout.

## Owed to later stages
Router classifier + eval (later, needs data) · M3–M6 picks (Stage 12) · M8 (Stage 11) · M9 (Stage 16) · M10/M11 (Stage 9) · Gemini capacity tier / Priority PayGo (Stage 19) · price doubling Jan 2027 (Stage 18) · mid-stream fallback (Stage 15) · admin panel: Claude limit + alerts (L1/L3 doc sync).

## LV-1 additions
Flash-Lite latency/accuracy · Gemini 3.8 PayGo tier · Claude 529 vs 429 on Vertex · cross-model history conversion (sentinel signature, synthetic assistant turns).

## Doc-sync 2026-10-06 (ADR-0007 – reranker = Vertex Ranking API, owner)
- **Model registry M5 (reranker):** Vertex AI Ranking API `semantic-ranker-default-004` (global, pinned id, never `@latest`) – replaces bge-reranker-v2-m3 in the Executor. Not a generative model: no thinking / sampling settings.
- **M3 (Gemini 3.1 Flash-Lite) note:** the model page lists Flex / Priority PayGo, but LV-130 calls on `global` came back `traffic_type = ON_DEMAND` (Standard) – no change to M3.

## Doc-sync 2026-10-07 (Stage 21 Task 1.3 brief – mini-LLM turn router)
- **Owner decision 2026-10-07 (provisional – ADR-0009 after LV-133):** the turn / intent router becomes a **mini LLM**: one structured call per turn returning `intent` + `tier` (RT-3 tiers). The Stage 7 rules (audio / video → Gemini, size / pages, Claude switch, Claude budget, effort per profile, timeout → Gemini Normal) **stay as the final gate in code** – the model never overrides money or permission rules. Revisits RT-1 (rules only) and RT-2 (classifier Later); M2 router = `gemini-3.5-flash-lite` provisional (3.1 Flash-Lite = comparison).
- **Phase 1 = shadow mode:** the router call is made and logged (ids + enums only, NO_CONTENT), routing still uses the rules until LV-133 + an eval prove the router. RT-1 "signals logged for later" becomes the router's eval data.
- **Two routers kept apart:** model router (Stage 7, which model / effort) vs intent router (which campus job / agent – campus planning open, not locked). Intent labels in LV-133 are a **test taxonomy only**.
- **LV-133 (Task 1.3):** 3.5 Flash-Lite minimal (required) vs 3.5 low and 3.1 minimal (probes) on a synthetic 140-case set (en / tanglish / ta / hi / hinglish); pass = intent accuracy ≥ 0.95 overall and ≥ 0.90 per group, invalid ≤ 1, p95 ≤ 400 ms (RT-2). Router cost per user per day → FD row at close (owner decides; reviewer's planning figure with 1.5k in / 50 out tokens: ≈ ₹1.49 at 25 turns, ≈ ₹2.99 at 50 turns, 2026 prices).
- **Checked and not chosen (2026-10-07):** MaaS models on Vertex (gpt-oss-120b / 20b, Gemma 4 26B, Mistral Small 3.1, Qwen3, Grok 4.1 Fast, Llama 4, MiniMax, GLM) – tested only if 3.5 Flash-Lite fails (new adapter + Stage 20 dependency approval); Gemini 2.0 Flash(-Lite) retired 1 Jun 2026, 2.5 Flash(-Lite) retiring not before 16 Oct 2026; ready-made routers (NVIDIA LLM Router v2 – experimental, GPU, deprecated for NeMo Switchyard) not fit; EmbeddingGemma 2 (6 Oct 2026, Apache 2.0, on-device embedding) not a router – Later candidate for Android offline search / embedding cost lever only.

## Doc-sync 2026-10-08 (Stage 21 Task 1.3 review – ADR-0009 mini-LLM router)
- **ADR-0009 (owner, 2026-10-08, option A after LV-133):** router (M2) = `gemini-3.5-flash-lite`, thinking MINIMAL, pinned, JSON schema `{intent, tier}`, no retries, via `packages/gateway`. **RT-1 / RT-2 revised:** the rules are no longer the whole router but stay the **final gate** (RT-4 … RT-7, MR3, 7.9, Claude switch); router timeout **1.5 s (N-69)** replaces ≈ 400 ms – on timeout / error / 429 / invalid the rules default applies and `router_status` is logged.
- **Phase 1 = shadow mode:** the router call runs async, off the critical path; intent / tier / latency / status logged as ids + enums next to the rules' choice. Going live is a later owner decision on Phase 1 data (end-to-end pre-generation time with the router parallel to context assembly + M9 safety screen, agreement with rules and staff overrides, over-route rate, final intent list; merge with the M9 screen call to be evaluated).
- **LV-133 facts:** 3.5 Flash-Lite intent 0.9643 (every language group ≥ 0.93, follow-ups + campus 1.0), tier 0.79, over-route 2.9 %, 0 invalid; p95 1,249 ms (no call under 400 ms – ≈ 1 s floor from the VPC to `global`, as LV-130); `gemini-3.1-flash-lite` p95 7.9 s – not used as router; LOW thinking produced 0 thinking tokens. ≈ ₹0.63 / ₹1.25 per user per day (25 / 50 turns) – FD row pending (owner).

## Doc-sync 2026-10-08 (owner – turn-path helper models M3 / M9 → 3.5 Flash-Lite, provisional)
- **Owner OK 2026-10-08:** M3 query planner and M9 safety screen move from `gemini-3.1-flash-lite` to **`gemini-3.5-flash-lite` (provisional)** – the same pinned model as the router (M2, ADR-0009). Reason: both run before generation on the turn path, and LV-133 measured 3.1 Flash-Lite p95 7,927 ms (81 % of calls over 1 s, max 23.8 s) vs 3.5 Flash-Lite p95 1,249 ms from the dev VPC to `global`. 3.5 Flash-Lite is GA, retirement not before 21 Jul 2027 (Task 1.3 §1).
- The final choice stays with the tests: M3 → **LV-134** (Phase 2, before the planner brief), M9 → **LV-84** (Phase 4, 500 human-rated items) + LV-85 red-team. Thinking level, timeout and cost per turn are fixed there.
- Price: 3.5 Flash-Lite $0.30 / $2.50 per 1M tokens (FD-31) vs 3.1 Flash-Lite $0.25 / $1.50 (N-36). Planner / screen cost per turn is re-computed with real token counts at LV-134 / LV-84 (FD row then).
- **Unchanged:** M6 contextualizer, M7 summarizer (async, off the turn path) and the Stage 13 claim judge (VD-1, async) keep `gemini-3.1-flash-lite` (provisional). The review 1–12 rule "one helper model row" is split: turn-path helpers M2 / M3 / M9 = 3.5 Flash-Lite, async helpers = 3.1 Flash-Lite. Docs only – no code, Terraform or test change (M3 / M9 are not built yet).

## Doc-sync 2026-10-10 (ADR-0012 – Claude through the first-party Claude API)
- **Model registry – Claude provider (owner, 2026-10-10):** Claude Sonnet 5.5 / Opus 5.5 are called through the **first-party Claude API** (Anthropic), not Vertex AI: `inference_geo` `global`, WIF credentials (no API key), `anthropic` SDK `AsyncAnthropic` in `packages/gateway`. Model ids are the first-party ids (`claude-sonnet-5-5`, `claude-opus-5-5`, pinned). Gemini models (M1 – M9 Gemini rows) stay on Vertex GLOBAL. RT-6 fallback for a Claude failure = Gemini (no second Claude provider). RT-7 per-company Claude limit unchanged; the Anthropic workspace spend limit is an extra backstop.
- Future option, not built: Claude via Amazon Bedrock's India endpoint (Mumbai + Hyderabad; Opus 5 / Sonnet 5 / Haiku 4.5 at launch) if in-India model processing is ever required – own ADR.

## Doc-sync 2026-10-10 (Stage 21 Task 1.10 brief – Model Gateway)
- **Registry (7.10 / RT-9) as built:** public choices `auto` (→ Gemini, RT-1 – no files yet) · `gemini-flash` = `gemini-3.8-flash` · `claude-sonnet` = `claude-sonnet-5-5` · `claude-opus` = `claude-opus-5-5` (manual only) · M2 router `gemini-3.5-flash-lite`; pinned ids only in the registry module; a registry version is stamped on every turn (L4-G48). Output ceilings per profile N-74.
- **RT-4 mapping:** Gemini `thinking_level` LOW / MEDIUM / HIGH; Claude `thinking: adaptive` + `output_config.effort` low / medium / high (always sent – Sonnet 5.5 defaults to high, Opus 5.5 to medium). Claude thinking `display` stays at the 5.5 default `omitted` and Gemini `include_thoughts` off until the web-app thinking panel (Stage 14).
- **RT-8 switch:** `company_settings.claude_enabled` (05-1), set by the ops command `set-claude`; a Claude choice while off is answered by Gemini with fallback reason `claude_off` (7.9 "Claude switch off → Gemini"); the Gemini → Sonnet fallback (7.12) requires it. The "+ limit left" half (RT-7, N-29) comes with budgets (block 7); until then the Anthropic workspace spend limit is the backstop.
- **7.11 / 7.12 additions (ADR-0012 error shapes):** Anthropic org spend cap (429 `enforced_spend_limit_reached`) or user / workspace spend limit (400 "specified … API usage limits") = "Claude limit reached" → every Claude model skipped for the turn → Gemini + label; a Claude credential (WIF) failure → Gemini. Claude `stop_reason: refusal` → finish `blocked`, no fallback (RV-2 sticky Gemini for allowed categories comes with the safety work).
- **ADR-0009:** the router call type is built in this task; the per-turn shadow call starts with the Turn Executor task.

## Doc-sync 2026-10-12 (Stage 21 Task 1.11 brief – router shadow built OFF, pinned continuation)
- **ADR-0009 §4 shadow mode (owner 2026-10-12):** the per-turn router call is built in the Turn Executor (async, never awaited before generation, awaited after the turn within N-69 1.5 s, one `turn_router` line of ids / enums next to the rules' choice) but **switched off** (`ROUTER_SHADOW=off`) until the campus intent list and the router spec file exist – no spend, no throw-away labels. Only on a turn's first start, never on a resume or continuation.
- **7.12:** the ER-3 / resume continuation is served by the **same** pinned model, with no fallback hop (mid-answer fallback is not locked).

## Doc-sync 2026-10-12 (Stage 21 Task 1.10b brief – Haiku 5.5 as router candidate, owner)
- **Owner 2026-10-12:** the company Claude switch (RT-8) is a **cost** switch, not a data-protection boundary – a Claude model may serve a helper role (router) for every company. **Claude Haiku 5.5** (`claude-haiku-5-5`, released 2026-10-07; $0.10 / $0.50 per 1M tokens ≤ 100K prompt vs Gemini 3.5 Flash-Lite $0.30 / $2.50; Vals.ai Vals Index 54.3 % vs 36.7 %) is tested as M2 router in **LV-135** (Task 1.10b, before Task 1.11). Pass (intent ≥ 0.95, ≥ 0.90 per group, invalid ≤ 1, p95 ≤ 1.5 s) → an ADR revising ADR-0009 §1 + FD row; until then M2 stays `gemini-3.5-flash-lite`.
- **Helper roles M3 / M6 / M7 / M9 / claim judge / memory extract:** each later choice test carries a Haiku 5.5 arm (LV register doc-sync 2026-10-12); audio and Google-grounded content stay Gemini-only.

## Doc-sync 2026-10-12 (Stage 21 Task 1.10b close – ADR-0013 router = Claude Haiku 5.5, thinking disabled)
- **LV-135 FAIL on latency only** (`lv1/results/LV-135.json`): Haiku 5.5 adaptive / effort low intent 0.9929, p95 2,328 ms; Haiku 5.5 thinking disabled (probe) intent 0.9929, tier 0.6714, p95 1,538 ms (one sample over N-69); Gemini 3.5 Flash-Lite MINIMAL intent 0.95 (7 misses), tier 0.7786, p95 1,108 ms.
- **ADR-0013 (owner 2026-10-12 14:53 IST, revises ADR-0009 §1):** **M2 router = `claude-haiku-5-5`** on the first-party Claude API (`global`, WIF), `thinking: {"type": "disabled"}` + `output_config.effort` `low` (RT-4 explicit), structured output with the caller's string enums (+ `additionalProperties: false`), `max_tokens` 1,024 (N-74), no sampling parameters, no retries, case-insensitive enum match. **N-69 1.5 s unchanged** → rules default (≈ 6 % of calls expected over it). Rules stay the final gate (RT-4 … RT-7, MR3, 7.9); shadow mode and the go-live decision (ADR-0009 §4 / §5) unchanged – go-live also checks tier accuracy, timeout share and stability.
- **RT-8:** the company Claude switch is **not** consulted for the router (owner: cost switch); router spend is not counted toward a company's Claude limit (RT-7) until budgets (block 7) decide. No router fallback model; router calls do not feed the main-model breakers (ER-13).
- **Registry 7.10:** M2 row → Haiku 5.5 (thinking disabled); the `gemini-3.5-flash-lite` MINIMAL row stays in code as the non-default alternative. Built in Task 1.11 Part 2 item 2.6a (addendum 2026-10-12); shadow call still OFF.
- **Helper models:** latency-sensitive helper tests use the Haiku arm with thinking disabled, effort low (LV register doc-sync 2026-10-12 close).

## Doc-sync 2026-10-14 (Task 1.13 close – ADR-0014)
- **Registry role `job` (no M-number):** row `title-claude-haiku` – `claude-haiku-5-5`, thinking disabled, effort low, max 40 output tokens, no fallback, the company Claude switch is not read (ADR-0014); `REGISTRY_VERSION` 2026-10-14.1. The summary job (Task 1.14) is a second row of the same role.
- **ADR-0014 extends ADR-0013 §3** (the Claude switch is a cost switch) from the router to the internal worker jobs. Future candidate C-1b is unblocked for helper roles; the Haiku comparison arm rule for helper tests (LV register 2026-10-12) stays.
