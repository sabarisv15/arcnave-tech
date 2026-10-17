# P11 live checklist — error matrix, breaker, labelled fallback (ADR-0081)

Run after the owner merges and the deploy is live. Migration `0033_fallback_and_refusal` must have
applied (`"migrations applied"` in the revision's logs). No upload is needed except where named.

| # | What to do | What to ask / send | Expected result | What a failure looks like |
|---|---|---|---|---|
| 1 | Normal turn on Auto | "hai, oru line la sollu: what is GST?" | Answer from Gemini 3.8 Flash; label under it shows only the model name (no "Answered by…") | A "Answered by …" label on a normal turn; an error card |
| 2 | Kill switch on Sonnet: set `MODELS_DISABLED=Sonnet 5.5` (`--update-env-vars`), pick **Sonnet 5.5** | "Explain recursion in two sentences." | Answer from Gemini; label "Answered by Gemini 3.8 Flash because Sonnet 5.5 is switched off"; reload the chat → label still there; `/models` shows Sonnet unavailable, reason `disabled` | Answer labelled Sonnet; no label; label gone after reload; a 400 |
| 3 | Same, model **Auto**, with `MODELS_DISABLED=Gemini 3.8 Flash` | "What day is it today?" | Sonnet answers, label "Answered by Sonnet 5.5 because Gemini 3.8 Flash was unavailable"/"is switched off" | `no_model_available` card; Gemini answers |
| 4 | Remove `MODELS_DISABLED` again | — | `/models` shows all three available | A model still `disabled` |
| 5 | Incident banner: set `INCIDENT_BANNER=Testing the banner` | Open the app | A banner with exactly that text above the chat; `GET /v1/status` → `{"incidentBanner":"Testing the banner"}`; unset it → banner gone after reload | No banner; banner text differs; `/v1/status` 401 |
| 6 | Stop mid-answer, then greet | "Write a 600-word essay on monsoons" → Stop after a few lines → "hai" | The second reply answers "hai" and does not continue the essay (the history now marks the stopped answer) | The essay continues; the reply quotes "[This answer was stopped…]" |
| 7 | Failure card support code | Trigger any error (e.g. #2 with `FALLBACK_ENABLED=false`) | The card shows "Support code: …" small under the text | No code; the code inside the sentence |
| 8 | Fallback off: `FALLBACK_ENABLED=false` + `MODELS_DISABLED=Sonnet 5.5`, pick Sonnet | "hi" | Error card `model_unavailable` ("This model is unavailable"), no other model answers | Gemini answers anyway |
| 9 | Gemini safety: ask something Gemini blocks (owner's choice of a known test prompt) | — | Card "This answer was blocked" (info tone); no other model tries; usage row `status=blocked`, `refusal_category` set | `empty_response`; Sonnet answers it; generic error |
| 10 | Tool timer: in a project chat with web search on | "Search the web for today's top news in Chennai" | Normal answer (search under 20 s); if search times out the answer says the step could not be done | A hang longer than 20 s on the search step |
| 11 | Logs | Cloud Logging, the turns above | Coded lines only: `model_fallback`, `provider_retry`, `provider_quota_zero`, `finish_reason_unknown`, `retry_budget_spent` — ids, aliases, codes; no prompt or answer text | Prompt or answer text in a log line |

Rollback lever: `FALLBACK_ENABLED=false` turns every hop off (failures then end with their code, as
before P11); `MODELS_DISABLED=` (empty) clears the kill switch.
