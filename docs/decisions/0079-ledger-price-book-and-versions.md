# ADR-0079: The model-call ledger, the price book, the deletion ledger, and regenerate keeps the old answer

- Status: accepted (task tech-p05 wave 2 = NEW-PLAN P22). Tested offline; not merged, not deployed.
- Date: 2026-10-17
- Task: P22 ([`docs/ops/p05-wave-plan.md`](../ops/p05-wave-plan.md) §2, §4). Evidence:
  [`docs/ops/p22-result.md`](../ops/p22-result.md). Live checklist:
  [`docs/ops/p22-live-checklist.md`](../ops/p22-live-checklist.md).
- Supersedes in part: [ADR-0038](0038-edited-prompts-make-versions.md) §5 ("one conversation, one row … a switch
  between versions does not write") and its consequence "Regenerating an answer (retry) still
  replaces it in place". ADR-0038 is not rewritten; it carries a "Superseded in part" note.
- Builds on: [ADR-0078](0078-durable-turns.md) (the turn, `settleTurnTx`, `budget_reservations`;
  its settle order is unchanged).
- Models used: Opus 5.5 (one agent).

## Stage decisions applied

Stage 4 E19 (one usage row per model call), G4 (deletion ledger and sweep; the 23-day value is
OQ-15, unchanged); Stage 5 P5 (data map + sweep test), P11 (deletion ledger outside the
restorable database), TF (effective-dated price table, reservation rows, monthly-partitioned
ledger with price version and traffic tier), F4b (regenerate keeps the old answer as a version;
the chosen version stored on the server); Stage 17 OD-8 (four clocks), OD-13 (per-call usage
capture, `usage_source`, `provider_ref_type` / `provider_ref`), LG-1 / LG-3 (coded, allowlisted
`model_call` and turn lines); Stage 18 CD-1 (price book as dated code rows; the env JSON stays
until the switch). Numbers: N-34 (deletion ledger 1 year: a bucket lifecycle rule, infra), N-36
(the price book), N-37 (FX for `cost_inr`).

## Claude

- **Usage per request.** Claude's Messages API reports usage per response (`message_start`, then
  `message_delta`), and every request of a tool loop is billed on its own. "total_input_tokens =
  cache_read_input_tokens + cache_creation_input_tokens + input_tokens" (Claude docs, Prompt
  caching; already cited in `providers/anthropic.ts`). The adapter now reports each request as a
  `call_usage` event with Claude's message id; the ledger stores one row per request.
- **Prices.** Read this session from the `claude-api` skill (cached 2026-10-06):
  `shared/models.md` and `shared/model-migration.md` "Migrating to Claude Haiku 5.5": Haiku 5.5
  is $0.10 / $0.50 per MTok for prompts of 100K tokens or fewer ($0.50 / $2.50 above); "cache reads
  are 0.1x the input rate, 5-minute cache writes 1.25x". Opus 5.5 $4 / $20, cache reads $0.20;
  Sonnet 5.5 $2 / $10. The skill gives Sonnet 5.5 cache reads as **$0.20**; `.env.example`
  (Stage 18 doc-sync 2026-10-10) gives **$0.10**. The book follows `.env.example`, as the brief
  requires, and the difference is an OWNER ITEM (`p22-result.md`).
- **Regenerate.** In Claude's app a retried answer is kept: the earlier one stays reachable with
  `< i / n >` under the answer (ADR-0038 recorded this as the gap left open: "Claude also keeps
  retried answers as versions"). ArcNave now does the same, with ADR-0038's version machinery.
- **Ledger partitions, price table trigger, deletion ledger layout, log allowlist.** No Claude
  equivalent; Stage 5 / 17 / 18 decisions (ADR-0071: the stage wins). Mechanisms the stages do
  not fix are labelled "ours" below.

## Decision

1. **Per-call usage (E19, OD-13).** A new provider event `call_usage { ordinal, usage, usageSource,
   finishReason, providerRef?, ttftMs?, durationMs? }` is emitted by the Claude and Gemini adapters
   at the end of every request (round), with that request's usage only. A stop mid-request emits
   the provider's partial counts as `usageSource: 'provider_partial'`; a request with no metadata is
   `exact: false`, zeros, `'none'`. There is no `estimated` (Invariant 3; OQ-08's provider-partial
   reading). `CallUsage` (in `providers/types.ts`) is the wave-plan §4 contract:
   `{ ordinal, attempt, role, providerModelId, usage, usageSource, finishReason, providerRef?,
   ttftMs?, durationMs? }`, plus an optional `startedAt` (the partition key; defaults to the turn's
   start). `role`: `answer | forced_answer | title | style | summary | router`.
2. **The turn is the sum of its calls.** `streamAndCollect` and the forced answer collect the calls
   into `state.calls`; the turn's usage is `usageFromCalls`: counts summed when every call is exact.
   When one call has no counts the turn is `exact: false` with zeros (Invariant 3, the same rule
   `addRequestUsage` kept), and the ledger keeps each exact call's own counts in its row: the
   per-call data is no longer lost, and no part is shown as the whole. A provider that reports no
   `call_usage` (the test fakes) gets one call made of its `completed` total. A provider request
   that failed (`ProviderError`, or the turn deadline) gets a call row with no counts
   (`outcome: 'error'`, `'none'`); a refusal already has its own call, and an error of ours (a
   database write) made no request and writes none. A stop that the SDK raises as an error still
   reports the in-flight request's partial before the error (both adapters).
3. **The ledger (TF).** `model_calls` (migration `0031_ledger`), one row per call, written by
   `ledger.recordCalls(tx, turnRef, calls)` inside the usage step of `settleTurnTx` (step 4 + 5;
   P08's order is unchanged). Partitioned `BY RANGE (started_at)` by month, primary key
   `(id, started_at)`, with a DEFAULT partition so a settle never fails for a missing month.
   `ensureLedgerPartitions` creates this and next month's partitions at boot and after each
   retention sweep, outside the sweep's transaction (ours). Each row carries the call's price,
   `price_version`, `traffic_tier` (`standard`), `cost_inr` with the `fx_inr_per_usd` it used, its
   provider ref and its clocks. Ids, codes and counts only.
4. **Cost.** Each call is priced at the rate in effect when it was made; the turn's `cost_usd` is
   the sum, and null when any call is unpriced (Invariant 2). A call uses a token type without a
   rate → no price, never a zero; a type it did not use needs no rate. The duplicate
   `computeCostFor` in `turn/events.ts` is removed; `done` shows the usage row's own figure.
5. **The price book (CD-1, N-36).** `config/priceBook.ts`: rows `{ providerModelId, tokenType
   input|output|cache_read|cache_write_5m, trafficTier, usdPerMTok, effectiveFrom, effectiveTo,
   priceVersion, source }`. Sonnet 5.5 $2 / $10 / $0.10 / $2.50 and Opus 5.5 $4 / $20 / $0.20 / $5
   from 2026-10-10; Gemini 3.8 Flash list $1.50 / $7.50 / $0.15 from 2026-10-11 (owner decision
   2026-10-15, no promo row, no cache-write row: Gemini bills none); Haiku 5.5 (P13's helpers)
   $0.10 / $0.50 / $0.01 / $0.125 from 2026-10-06, the ≤ 100K card only (a longer prompt is priced
   null). `services/pricing.ts` prices from the book, or from `PRICING_TABLE` when
   `PRICE_SOURCE=env` (default `book`). `price_table` mirrors the book by an idempotent upsert at
   boot; `numeric(12,6)`; unique `(model, token type, tier, effective_from)`; a trigger refuses two
   rows of one model, type and tier that overlap in time (ours: a trigger rather than an exclusion
   constraint, so the migration needs no `btree_gist`).
6. **Reservations.** `budget_reservations` gains `settled_usage_record_id` and `price_version`;
   the settle names the usage row a `settled` hold was settled against. Rupee reservation and the
   daily rupee ceiling (FD-08, N-63) and money as decimals in the ledger (LED-1) are OQ-27, skipped.
7. **The four clocks (OD-8)** are nullable `usage_records` columns: `provider_ttft_ms` (request
   sent → first stream event, retries included), `first_visible_ms` (turn start → first answer
   text sent), `turn_total_ms` (turn start → settle), `output_tps` (output tokens over the calls'
   time after their first event; null unless exact). Null means not measured, never 0.
8. **Coded log lines (LG-1, LG-3).** `observability/logEvent.ts`: `LOG_CODES` (`model_call`,
   `chat_turn_finished`, `retention_sweep`, `deletion_ledger`; `gateway_*` reserved for P11),
   `FIELD_ALLOWLIST`, and `logEvent()`, which drops every field not on the list (strings cut to 128
   characters; two map fields keep numeric entries only). "turn timing" became
   `chat_turn_finished`. No allowlisted name matches `prompt|text|content|query|title|filename|email`
   (the content-leak test checks it; `promptVersion` was left off for that reason).
9. **The deletion ledger (P11, G4).** `services/deletionLedger.ts` writes JSON records
   `{ kind: chat_purge | account_delete, phase: requested | completed, subjectId, userId, at,
   counts }` to object storage under `DELETION_LEDGER_PREFIX` (default `deletion-ledger`, at least
   5 characters so it is never a 4-hex owner shard; `deleteOwned` lists only `<shard>/…`). Order:
   `requested` → bytes → `completed` → rows. A failed record stops the deletion: the retention
   sweep leaves the chat for the next sweep, and account deletion fails with the account intact.
   The storage key check accepts this second key shape for writing and reading only. The one-year keeping is a bucket
   lifecycle rule (infra, in the live checklist).
10. **Regenerate keeps the old answer (F4b).** `resetForRetry` (P08's guarded reset): when the
    answer is `complete` or `stopped` with text, it is kept, and the start forks a new version in
    the same transaction as the turn: a chat with `parent_chat_id` = the chat, `root_chat_id` = its
    family, `fork_seq` = the answer's seq; the messages before the answer (its prompt included)
    copied with `copyMessages` (ADR-0038); a fresh assistant row at the answer's seq. The turn's
    file ids are mapped to the copies on the copied prompt. A failed or empty answer is cleared in
    place, as before. `GET /chats/:id` gives versions on answers as well as prompts.
11. **The chosen version is stored.** `chats.active_chat_id` on the family's root is set by
    `PUT /chats/:id/active-version` and by every generate (to the chat the turn runs in). `GET
    /chats` lists, per family, that version when it is live, else the one used last (ADR-0038 §5,
    which this replaces).
12. **One running turn, over the family.** Every start locks the family's root row, then the chat
    (always in that order, so two starts cannot deadlock), and refuses with 409 `run_in_progress`
    when any chat of the family has a queued or running turn (each taken over first when its lease
    lapsed). The reason: a regenerate's turn lives on the new version, so the per-chat partial
    index `uq_turns_running_chat` alone would let a second regenerate of the same answer (on the
    old chat) start beside it. Under the root lock, the second start sees the first one's turn and
    is refused; P08's exit test (a) still gives exactly one 200 and one 409 for send/regenerate and
    regenerate/regenerate. The partial index stays as the per-chat backstop. The check is
    app-level, under the lock (ours: there is no family column to index on).
13. **The frames.** `start` already carries `chatId`. `ack` carries `chatId` only when the turn
    runs in another chat than the one the request named (so every other run's frames are
    unchanged). The client follows the turn there: the run's rows, its controller (Stop) and the
    page move to the new version, and a reconnect goes to the new chat's `/stream`.
14. **Data map (P5).** `db/dataMap.ts` gives every table a retention class and what deletes it;
    `dataMap.test.ts` fails on a table without an entry and on a personal table that account
    deletion cannot reach through cascading foreign keys.

## Deviations from the plan (written reasons)

- **Haiku cache rows exist.** The brief said "cache rates unknown → no row". The `claude-api`
  skill, re-checked as the brief asked, states the multipliers (0.1x read, 1.25x 5-minute write),
  so the rows are $0.01 and $0.125. A cache count on a Haiku call is now priced rather than null.
- **One inexact call makes the turn row `exact: false` with zeros**, not the sum of the others
  (brief: "turn total = sum of call rows … one inexact among exact → turn exact:false, others keep
  counts"). Invariant 3 ("exact: false with zeros") wins over the brief (CLAUDE.md: the invariants
  win); the code review caught the first version, which summed. "Others keep counts" holds in the
  ledger: each exact call's row keeps its counts. So the turn row equals the sum of its call rows
  exactly when every call is exact; otherwise it is zeros and says why.
- **The storage key check takes a ledger key for writing and reading only** (put, get, exists,
  size). Delete, copy, stream and upload paths refuse it, so no deletion path can remove a record.
- **Price rows reach the database at boot, not in the migration.** The exit test applies 0031 and
  runs the boot upsert twice (idempotent) before checking the rows.
- **`attempt` is 1** for every call P22 writes: a gateway attempt that failed reports no call, so
  the call that answered is the attempt that succeeded. P11 fills the real attempt number.
- **`ack.chatId` is optional**, present only for a forked regenerate, so the characterization
  snapshots of every other run did not change.
- **Account deletion with a ledger failure answers 500** (an untyped storage failure), with the
  account intact. A typed code is a P11 / ER item.

## Not in this ADR

P22b (later task): UUIDv7 + `updated_at`, TB1, TB8, F4c, F8b, OD-15b, V-20 / V-21. Owner items:
message text split (OQ-25), search text out of URLs (OQ-18), N-02 32 k and the 23-day purge
(OQ-15), rupee reservation / ceiling and decimals (OQ-27). Helper calls (P13) and gateway
attempts (P11) build `CallUsage` and are wired to `recordCalls` by the orchestrator at merge.

## Consequences

- Every settled turn writes 1 + N rows more (one per model call), in its settle transaction.
- A cost is now reproducible: each call names the rate set it was priced with.
- A regenerate makes a chat row and copies the conversation before the answer (rows, not bytes),
  as an edit already did.
- A start takes one more lock (the family root) and one more read (the family's active turns).
