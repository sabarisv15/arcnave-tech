# P22 live checklist — the ledger, the price book, the deletion ledger, regenerate versions

For the owner, after merging (ADR-0079). Run against the live service with your own account.
"DB" means a read-only `psql` session on the production database.

## 0. Before the first deploy (infrastructure)

| Do | Expected | A failure looks like |
|---|---|---|
| Add a bucket lifecycle rule on `STORAGE_GCS_BUCKET`: objects under the prefix `deletion-ledger/` are deleted after **365 days** (N-34). | The rule is listed on the bucket. | No rule: ledger records stay forever (not a data loss, but not the decided retention). |
| Nothing to set in the environment: `PRICE_SOURCE` defaults to `book`, `DELETION_LEDGER_PREFIX` to `deletion-ledger`. | — | — |

## 1. Migration and boot

| Do | Expected | A failure looks like |
|---|---|---|
| Deploy; read the new revision's logs. | `migrations applied`; no `price table not synced`, no `ledger partition not created`. | `migration failed` (0031), or one of the two warnings. |
| DB: `select count(*) from price_table;` | **14** rows (Sonnet 4, Opus 4, Gemini 3, Haiku 4). | 0: the boot upsert did not run; costs are still priced from the code rows, only the table is empty. |
| DB: `select relname from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'model_calls'::regclass;` | `model_calls_default` and this and next month's partitions. | A month missing: rows go to the DEFAULT partition (still readable); report it. |

## 2. One answer, its calls and its cost

| Do | Expected | A failure looks like |
|---|---|---|
| New chat, **Gemini 3.8 Flash**, ask "What is 2 + 2?". | Normal answer; the footer cost is not "no price". | Cost missing or "$0.00". |
| DB: `select id, input_tokens, output_tokens, tokens_exact, cost_usd, price_version, provider_ttft_ms, first_visible_ms, turn_total_ms, output_tps from usage_records order by started_at desc limit 1;` | `tokens_exact` true, `price_version` `gemini-3.8-flash@2026-10-11-list`, the four clocks filled (none 0 unless really 0). | Clocks null on a finished answer, or `price_version` null with a cost. |
| DB: `select ordinal, role, usage_source, outcome, input_tokens, output_tokens, cost_usd, provider_ref_type from model_calls where usage_record_id = '<id above>' order by ordinal;` | One row, `answer`, `provider`, `ok`, `response_id`; its tokens and cost equal the usage row's. | No row, or a sum that differs from the usage row. |
| Same chat, **Sonnet 5.5**, ask for something that uses a tool (e.g. "search the web for today's IST time"). | Answer; DB shows one `model_calls` row per request (2 or more), `message_id` refs; the usage row is their sum. | One row for a multi-request answer, or counts that do not add up. |
| Press **Stop** during a long Sonnet answer. | DB: the last call is `usage_source = provider_partial`, `outcome = partial`. | `none` with zeros when the stream had started. |

## 3. Regenerate keeps the old answer

| Do | Expected | A failure looks like |
|---|---|---|
| In a chat with a finished answer, press **Regenerate**. | A new answer streams in its place; under it `‹ 2 / 2 ›`. The URL changes to the new version's id. | The old answer is gone with no `1 / 2`, or the stream stops when the URL changes. |
| Press `‹`. | The old answer, `1 / 2`. | Error, or the new answer. |
| Reload the page, open the conversation from the sidebar. | It opens on the version you chose last (the old one). | It opens on the newest version: the choice was not saved. |
| Open the same conversation on another device / browser. | Same version as above. | — |
| Press Regenerate on an answer that **failed** (red card). | The answer is replaced in place; no `1 / 2`. | A new version for a failed answer. |
| Regenerate, and press **Stop** while it streams. | It stops; the stopped answer is version 2. | Stop does nothing (the run is in the new chat; Stop must reach it). |

## 4. Deleting

| Do | Expected | A failure looks like |
|---|---|---|
| Delete a chat. After the purge window (N-33; today's value), check the bucket: `gsutil ls gs://<bucket>/deletion-ledger/**` | `chat_purge-<chatId>-requested.json` and `…-completed.json`; each holds only ids, a time and counts (`objects`, `messages`). | No record, or a record with a title / text / file name. |
| Delete a test account (Settings → Delete account). | Both `account_delete-<userId>-requested.json` and `…-completed.json` exist after the account is gone. | The account is gone with no record, or the delete fails with the bucket healthy. |

## 5. Logs

| Do | Expected | A failure looks like |
|---|---|---|
| Logs Explorer: `jsonPayload.code="chat_turn_finished"` for your turn. | One line per turn with ids, codes, counts, `providerTtftMs`, `firstVisibleMs`, `turnTotalMs`; no prompt, reply, title or file name. | Any user text in the line. |
| `jsonPayload.code="model_call"`. | One line per model call, same fields as the `model_calls` row. | — |
| `jsonPayload.msg="turn timing"`. | No new lines (replaced). | — |
