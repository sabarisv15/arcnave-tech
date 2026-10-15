# ArcNave – Stage 5.2 · Flows
_2026-10-01 · F1 LOCKED (FD-1–FD-3 OK) · F2 LOCKED (GD-1–GD-3 OK) · F3 LOCKED (SD-1–SD-6 OK) · F4 LOCKED (ED-1–ED-4 OK) · F5 LOCKED (UD-1–UD-4 OK) · F6 LOCKED (SHD-1 = B, SHD-2–4 OK) · F7 LOCKED (MD-1–MD-4 OK) · F8 LOCKED (XD-1–XD-4 OK) · 5.2 COMPLETE · Order: F1 Send · F2 Generate · F3 Stream/resume · F4 Edit/regenerate · F5 Upload · F6 Share · F7 Memory · F8 Delete_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - **F7 Memory (Stage 11):** saving happens **in the turn** – the model calls memory_write after writing its answer when the user states a lasting fact or asks to remember/correct; forget → memory_delete; server validator on every write; UI "Saved to memory" notice. MD-3/MD-4 background extractor retired (fallback design only). MD-1 (project chats use personal memory) unchanged.
> - **F8 Delete (Stage 11 MEM-DEL A):** chat delete removes that chat's source links; a memory line left with no source **and** created automatically is deleted; explicitly saved or user-edited lines stay (dialog says so).


> **Doc-sync 2026-10-03 (Stage 15) – see Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md:**
> - F3 client reconnect numbers (ER-10); F2 GG9 billing from last cumulative usage kept; stream recovery = one "continue" attempt then partial + Continue (ER-3); F5 upload resume 308/Range, 410/404 new session (EH10).

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - F6 share snapshot: artifacts shown as name + type only (G-H, same as files SHD-2).

## F1 – Send message
| Step | Layer | What happens |
|---|---|---|
| 1 | L1 | User sends text (+ attached ready files, model choice, project) with Idempotency-Key; Send disabled while a turn runs |
| 2 | L2 | ALB + Cloud Armor (WAF, per-IP throttle) |
| 3 | L3 | request-id → auth → app-version → rate limit (user+company) → schema/size check → idempotency → ownership (R12) |
| 4 | L4 Policy | allowed models list (Claude switch, budget), tools, memory on/off, project scope → budget reservation (R2) |
| 5 | L7 | One DB transaction: user message + message_contents + attachments + turn(QUEUED) + outbox row |
| 6 | L6 | Enqueue Cloud Task (turns queue) right after commit; outbox sweeper as backup (R10) |
| 7 | L3 → L1 | 202 {turn_id, stream URL}; client opens SSE → `ack` |

## Gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| FG1 | Same Idempotency-Key with different body → 409, never a second turn | Vendor pattern (L3) | MVP |
| FG2 | Second message while a turn is running in the same chat | Real products disable Send while generating | MVP (FD-1) |
| FG3 | Attached file still processing → 409 "file not ready" (Stage 3 D1); failed file must be removed first | ArcNave (AS-D6) | MVP |
| FG4 | Budget/quota finished → distinct error code (no retry), not 429 | Vendor pattern (L2-G3) | MVP |
| FG5 | Selected model not allowed (Claude off / budget) → Auto fallback with UI note, or clear error if user forced it | ArcNave (UI-5, R3) | MVP |
| FG6 | Message size limit (chars/tokens) → 413 before any model call | ArcNave rec | MVP (number Stage 18) |
| FG7 | Project chat: project instructions + project files added to turn scope | DM-8 | MVP |
| FG8 | Commit succeeded but enqueue failed → sweeper re-enqueues; task name = turn id (dedupe) | Vendor (Cloud Tasks) | MVP |
| FG9 | Turn row stores config stamp + allowed models + reservation at creation (reproducible) | G48 | MVP |
| FG10 | Offline send on mobile (queue on device) | Real products: not documented | Later |

## Decisions
| ID | Question | Rec |
|---|---|---|
| FD-1 | Second message during running turn | Reject (409) + client keeps Send disabled; user can Stop first |
| FD-2 | Message size limit | Yes, hard limit at API (exact number Stage 18) |
| FD-3 | Offline send | Later |

## F2 – Answer generation (Turn Executor)
| Step | Layer | What happens |
|---|---|---|
| 1 | L6 → L4 | Cloud Task hits Executor (OIDC) → load turn; if DONE/CANCELLED → no-op |
| 2 | L4 | Take lock lease + fencing (R13); re-check kill switch + budget (R2); send `status: thinking` fast |
| 3 | L7 | Load current branch path, stored rendered blocks (R1), summary (R6), project + admin instructions |
| 4 | L5 Context | System prompt version + instructions + memory (if on) + retrieval (chat + project files) + date (TH-2) |
| 5 | L5 Gateway | Model from allowed list (R3); Gemini/Claude rules (signatures, thinking, no temperature) |
| 6 | L4 loop | Stream → Redis (seq) → tool calls (L5 Tools) → repeat ≤ profile steps; checkpoint each step (R14); safety screen in parallel (SAF-1) |
| 7 | L4 Validator | Finish checks; refusal/block → retract + fallback rules (RV-2) |
| 8 | L7 | Final tx (fencing check): assistant message + contents + citations (grounded_by) + model_call_blocks + usage settle + turn DONE + outbox (title/summary/memory jobs) |
| 9 | L3 → L1 | `done` event; reservation released/settled |

## F2 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| GG1 | Duplicate task for a finished/cancelled turn → do nothing | Vendor (Cloud Tasks at-least-once) | MVP |
| GG2 | User pressed Stop before executor started → skip + release reservation | ArcNave | MVP |
| GG3 | Reply to Cloud Tasks with success for handled outcomes (even "failed" turns); error code only when a crash-safe retry is wanted | Vendor (Cloud Tasks retries on non-2xx) | MVP (GD-1) |
| GG4 | First event fast (`status: thinking`) – meets 2–3 s first-signal target (A3) | ArcNave | MVP |
| GG5 | Post-turn jobs (title, summary, memory) created in the same final transaction | ArcNave (outbox) | MVP |
| GG6 | Budget reservation released/settled on every end state (done, failed, cancelled, blocked, deadline) | ArcNave (R2) | MVP |
| GG7 | Partial answer saved with status on Stop/failure (Stage 3 D4) | ArcNave | MVP |
| GG8 | Model switched (fallback/auto) → note in UI + stored on message | ArcNave (UI) | MVP |
| GG9 | Stream broke mid-way → bill from last usage received (Claude usage cumulative) | Vendor (Anthropic) | MVP |
| GG10 | Provider block (Gemini SAFETY, Vertex CSAM block-event, Claude refusal) → retract + message status "blocked" | Vendor (Google, Anthropic) | MVP |

## F2 decisions
| ID | Question | Rec |
|---|---|---|
| GD-1 | Cloud Tasks retry | Success response for every handled end; retry only after crash (once, from checkpoint – AS-D3) |
| GD-2 | Chat title | Gemini Flash after first answer; user rename always wins (title_version) |
| GD-3 | History summary trigger | When history passes a size threshold (number in Stage 6) |

## F3 – Stream / resume
| Step | Layer | What happens |
|---|---|---|
| 1 | L1 | Client opens SSE `GET /turns/{id}/events` (Last-Event-ID / after=seq) |
| 2 | L3 | Auth + ownership (R12); read Redis stream from seq; fan-out to all viewers |
| 3 | L3 | If Redis key missing/evicted/expired → send DB snapshot (partial/final) then continue live |
| 4 | L3 → L1 | Events: ack, status, thinking, delta, citation, tool_status, retract, ping (15 s), error, done |
| 5 | L1 | On drop → reconnect with last seq + jittered backoff; app background → on resume fetch state |

## F3 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| SG1 | Resume from last seq (no duplicate / missing text) | Vendor (OpenAI, Perplexity resume; L3-G2) | MVP |
| SG2 | Redis stream gone → DB snapshot fallback | Vendor (Memorystore volatile-lru) | MVP |
| SG3 | Reconnect storm after deploy/Redis failover → jittered backoff | ArcNave | MVP |
| SG4 | Ownership check on every re-attach | ArcNave (R12) | MVP |
| SG5 | Same turn watched from 2 tabs/devices → both get events | ArcNave | MVP (SD-2) |
| SG6 | Android kills background connections → fetch final state on reopen | Vendor (L1) | MVP |
| SG7 | Heartbeat ping every 15 s (long Claude thinking gaps) | Vendor (Anthropic, L2-G1) | MVP |
| SG8 | Retract replayed correctly after resume | ArcNave | MVP |
| SG9 | Open SSE = billed for whole duration (Cloud Run pricing); concurrency up to 1,000/instance (default 80) → relay is I/O-bound, set high concurrency; **API request timeout default 5 min would cut streams → set ≥20 min**; SIGTERM can still cut streams → client reconnect | ✅ Vendor (Astra T1) | MVP (SD-5) |
| SG10 | Expo: no built-in EventSource; `expo/fetch` supports streaming body (getReader) on Android. Browser EventSource can't send Authorization header → one shared fetch-based SSE client (web + Android) with own parser + seq resume | ✅ Vendor (Astra T3) + ArcNave | MVP (SD-4) |
| SG11 | ALB buffering of SSE chunks NOT documented → LV-1 live test; ALB response deadline 60 min (fixed), client TCP idle 610 s → 15 s ping fine | ⚠️ Partial (Astra T2) | LV-1 |
| SG13 | Android Doze/background limits stop network; FCM recommended for idle downstream; foreground service not for this | ✅ Vendor (Astra T4) | MVP: reopen → fetch; Later: "answer ready" push (SD-6) |
| SG12 | Redis stream kept N minutes after done, then DB only | ArcNave | MVP (SD-3) |

## F3 decisions
| ID | Question | Rec |
|---|---|---|
| SD-1 | Stream thinking summary | Yes (TH-1), separate `thinking` events |
| SD-2 | Multiple viewers of one turn | Allowed (read-only) |
| SD-3 | Redis stream after done | Keep ~15 min, then DB only |
| SD-4 | Stream client | One fetch-based SSE client for web + Android (no EventSource) |
| SD-5 | API service settings | Request timeout ≥20 min; high concurrency (number in Stage 18) |
| SD-6 | Phone in background | No background service; reopen → fetch; later FCM "answer ready" push with no chat content |

## F4 – Edit / regenerate
Real products (Astra R5, official help): Claude – edit creates a new chat version; ChatGPT – edit + regenerate + "Branch in new chat"; Gemini – edit + other drafts; Perplexity – edit + "Rewrite" with another model.

| Step | Layer | What happens |
|---|---|---|
| 1 | L1 | Edit = user changes an earlier user message → new sibling user message (same parent). Regenerate = new sibling assistant message under the same user message |
| 2 | L3 | Idempotency + ownership (R12); FD-1 (no running turn) |
| 3 | L4 Policy | Allowed models (R3); budget reservation (R2) – each version is a billable turn |
| 4 | L7 | Insert sibling message + turn; conversation.active_leaf → new branch |
| 5 | L4/L5 | F2 runs on the NEW branch path only: summaries keyed to path, files on path (R6); Claude thinking stripped from edit point (A1); provider blobs only to same provider (G27) |
| 6 | L1 | Version arrows (e.g. 2/3); switching version updates active_leaf on server |

## F4 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| EG1 | Only user messages editable; any earlier one, not just the last | Vendor (all 4) | MVP |
| EG2 | Edit/regenerate while a turn runs → Stop first (FD-1) | ArcNave | MVP |
| EG3 | Chosen version saved on server (same view on phone + web) | ArcNave | MVP (ED-2) |
| EG4 | New branch context = only its path (summary, files, memory candidates) | ArcNave (R6) | MVP |
| EG5 | Claude history: strip thinking from edit point; reuse exact stored blocks for the rest (A1, R1) | Vendor (Anthropic) | MVP |
| EG6 | Regenerate with a different model (like Perplexity Rewrite) | Vendor (Perplexity) | MVP (ED-1) |
| EG7 | Old branches stay stored until chat delete; share snapshot = branch visible at share time | ArcNave | MVP |
| EG8 | Memory already saved from an abandoned branch stays (user can delete) | ArcNave (M-rules) | MVP (ED-4) |
| EG9 | Edited message can change attachments (only ready files) | ArcNave | MVP |
| EG10 | Every version counts in usage / messages-left counter | ArcNave (R2) | MVP |
| EG11 | Title unchanged on edit (user rename wins) | ArcNave (GD-2) | MVP |
| EG12 | "Branch in new chat" (copy path into new chat) | Vendor (ChatGPT) | Later (ED-3) |

## F4 decisions
| ID | Question | Rec |
|---|---|---|
| ED-1 | Regenerate with another model | Yes, from allowed list |
| ED-2 | Version choice saved on server | Yes |
| ED-3 | Branch in new chat | Later |
| ED-4 | Memories from abandoned branch | Keep (visible, user can delete) |

## F5 – File upload (data path only; parsing details = Stage 9)
| Step | Layer | What happens |
|---|---|---|
| 1 | L1 | User picks file (chat or project) → client pre-check type/size (UX only) |
| 2 | L3 | POST /files: auth, ownership, quota (AS24), type allowlist, size limit → file row `pending_upload` → short-lived signed URL (content-type + size range) to `unscanned/tenant/<company>/<file_id>` |
| 3 | L1 → GCS | Direct upload with progress (no file bytes through our API) |
| 4 | L3 | POST /files/{id}/complete → verify object exists, size, generation → `uploaded` → enqueue (file-blocking queue) |
| 5 | L6 worker | malware scan → real type check (file signature) → ZIP expand (limits) → parse (Stage 9) → chunk → embed → index → `ready` / `failed` + reason |
| 6 | L1 | Step status shown (uploaded → scanning → reading → indexing → ready/failed); Send enabled when all attached files ready |

## F5 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| UG1 | Extension allowlist (after decoding name; double extensions/null bytes) + content-type is untrusted + file signature check – none alone is enough | ✅ Vendor (OWASP, Astra U1) | MVP |
| UG2 | Size limits per type (others: Claude 30 MB project file, Perplexity 50 MB, Gemini 100 MB, ChatGPT 512 MB) | ✅ Vendor (Astra R6) | MVP (numbers Stage 9) |
| UG3 | Quota check before giving upload URL | ArcNave (AS24) | MVP |
| UG4 | Same file uploaded again → reuse processed chunks only inside same company (never across companies) | ArcNave (AS17 + tenancy) | MVP (UD-1) |
| UG5 | OWASP: "ZIP files are not recommended"; Python warns zip bombs exhaust disk; metadata sizes alone not enough; zipfile.Path doesn't sanitize names (zip slip) → stream-extract with running byte/count counters, path check, 1 level | ✅ Vendor (OWASP, Python, Astra U1/U4) | MVP (UD-2) |
| UG6 | Password-protected PDF/Office → failed with clear reason | Vendor (Claude N3) | MVP |
| UG7 | HEIC/large images converted/resized for Claude (≤5 MB, ≤8000 px) | Vendor (N2) | MVP |
| UG8 | Infected file → quarantine/delete + audit + user message | Vendor (D11) | MVP |
| UG9 | Upload never completed → sweeper removes object + row | ArcNave (DF-4) | MVP |
| UG10 | Step-level status to client | ArcNave (AS23) | MVP |
| UG11 | Embedding = 1 text per request → many calls; per-company rate cap so one big upload doesn't slow others | Vendor (U8) + ArcNave (AS26) | MVP |
| UG12 | Project files vs chat files: different scope, same pipeline | ArcNave (DM-8) | MVP |
| UG13 | Storage name = generated UUID (OWASP); Google advises no PII in object names; custom metadata ≤8 KiB per object | ✅ Vendor (OWASP, GCS, Astra U1/U3) | MVP |
| UG14 | File deleted while processing → cancel job, tombstone, clean partial chunks | ArcNave (AS20) | MVP |
| UG15 | Resumable upload: signed POST starts session (session URI = upload token, valid 1 week); **size-range header ignored on POST** → backend creates session with max size (SDK `size`) + server re-checks size on complete; browser needs Origin header at session start (CORS) | ✅ Vendor (GCS, Astra U2) | MVP (UD-3, UD-4) |
| UG16 | Provider-ready copies cached as derivatives (Claude: text from DOCX/XLSX/PPTX, resized images ≤5 MB; Gemini: native PDF/images) | ArcNave (CF1–CF4) | MVP |

## F5 Claude-only (from saved Anthropic facts)
| # | Fact | Rec |
|---|---|---|
| CF1 | On Vertex, files go only as base64 inside the request (no Files API, no URL); request ≤ ~30 MB | Send derivative bytes from GCS per call; size pre-check |
| CF2 | Claude reads PDF + images (+ text) natively; DOCX/XLSX/PPTX are not native | Convert to text/PDF in Stage 9 |
| CF3 | PDF ≤600 pages; ~1,500–3,000 tokens/page + page image; password PDFs unsupported | Big PDFs via retrieval; reject encrypted (UG6) |
| CF4 | Images ≤5 MB (base64) on Google Cloud, ≤8000 px, >20 images → ≤2000 px; JPEG/PNG/GIF/WebP | Resize/convert (UG7) |
| CF5 | PDF citations give page numbers | Use for page-level citations |
| CF6 | claude.ai: 20 files/chat; per-file limit docs conflict (500 MB vs 30 MB); project files 30 MB | Benchmark only |
| CF7 | No audio input | Transcript first (CS1) |

## F5 decisions
| ID | Question | Rec |
|---|---|---|
| UD-1 | Dedupe scope | Within same company only |
| UD-2 | ZIP handling | Keep ZIP (Stage 1 requirement) despite OWASP warning: 1 level, only allowed types inside, max files + max unpacked size (numbers Stage 9), nested ZIP rejected |
| UD-3 | Resumable upload | Yes for files above a size threshold (number Stage 9) |
| UD-4 | Size cap for resumable uploads | Backend-created session with max size + size re-check on complete (delete if over) |

## F6 – Share (public link)
| Step | Layer | What happens |
|---|---|---|
| 1 | L1 | Chat owner clicks Share → warning "anyone with the link can see this" → confirm |
| 2 | L3 | Ownership (R12) + company setting public_links_enabled (RV-3) |
| 3 | L7 | Build snapshot of the visible branch (EG7): user/assistant text + allowed citations; strip thinking + Google-grounded answers (SL-1), memory notes, tool raw data, model blocks, file contents → store snapshot + token hash |
| 4 | L1 | Link `share.arcnave.tech/s/<token>` (separate origin, noindex, no cache – L2) |
| 5 | Viewer | Share page reads snapshot only; revoke/delete → 404 immediately |

## F6 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| SHG1 | Snapshot at share time; later chat changes not visible | Vendor (ChatGPT, L1 G3) | MVP |
| SHG2 | Token unguessable, only hash stored, token in path (not query) | ArcNave (DFR3) | MVP |
| SHG3 | Strip thinking + Google-grounded answers + internal data | Vendor (Google terms) + SL-1 | MVP |
| SHG4 | Uploaded files: name only, no download/preview on public page | ArcNave (B2B confidentiality) | MVP (SHD-2) |
| SHG5 | Citations to company files → file name only; web citations kept | ArcNave | MVP |
| SHG6 | Revoke works instantly (no cache) | ArcNave (L2 E-3) | MVP |
| SHG7 | Admin turns public links OFF → all existing links stop | ArcNave (RV-3) | MVP |
| SHG8 | Chat/account deleted → link dead (in deletion data map) | ArcNave (RV-3, R8) | MVP |
| SHG9 | Only chat owner can share (project chats too) | ArcNave | MVP |
| SHG10 | Owner can see and delete all own shared links | Vendor (ChatGPT) | MVP |
| SHG11 | Abuse: share page rate limit (Cloud Armor) + "report" link | ArcNave | MVP |
| SHG12 | "Update snapshot" of an existing link | Vendor (ChatGPT) | Later (SHD-3) |
| SHG13 | View counts / analytics | — | Later |

## F6 Claude-only
| # | Fact | Rec |
|---|---|---|
| CSH1 | Claude web search citations must be shown to end users (CT4) | If a Claude web-search answer is shared, its citations stay on the page |
| CSH2 | Claude thinking is internal reasoning (TH-1 shows summary in app only) | Never on share page (SL-1) |

## F6 real-product evidence (Astra H1–H5, official help)
| | Claude Team/Enterprise | ChatGPT Business/Enterprise | Perplexity Enterprise | Gemini (Workspace) |
|---|---|---|---|---|
| Public link | **Not available** – org only (default: specific people) | Workspace members only | Private by default; public allowed unless admin disables; org-only option | Docs conflict |
| Admin control | Turn off sharing, revoke, audit log | Enterprise can disable | "Allow public session sharing" switch | Admin on/off |
| Snapshot/live | Snapshot + "Update shared chat"; chat delete kills link | Can include later messages (live) | not documented | Snapshot; delete docs conflict |
| Files | File not included (org exception, no download) | Images/files may appear | artifacts (org) | images/canvas |
| Indexing | noindex on every page | not intended for indexing | not documented | not documented |

**Finding:** all business plans default to company-only sharing; Claude business has no public links at all. Our locked L1-G3 = public link → re-decide (SHD-1).

## F6 decisions
| ID | Question | Rec |
|---|---|---|
| SHD-1 | Link type | Default = company-only link (logged-in members of same company); public link only if company admin enables it (default OFF) – changes L1-G3 and RV-3 default |
| SHD-2 | Files on shared page | Name only |
| SHD-3 | Update snapshot | Later |
| SHD-4 | Warning before sharing | Yes |

**F6 lock note:** SHD-1 = option B → default share = company-only (logged-in members of same company); public link only if company admin enables (default OFF). Updates L1-G3 (was public) and RV-3 (public default ON → OFF).

## F7 – Memory
| Step | Layer | What happens |
|---|---|---|
| W1 | L6 | After turn DONE: memory job (background-low) – only if company memory ON + user memory ON + chat memory ON |
| W2 | L6/L5 | Read ONLY user-written text of this turn (+ mic transcript); never file/web/tool text (M11, SP19); skip blocked/refused turns |
| W3 | L5 Memory | Extractor model → candidate topics → sensitive filter (MEM-5 opt-in) → consolidate (update same topic, versioned) |
| W4 | L7 | Save memory + memory_event(source_message_id) |
| X | L4 | Explicit "remember / forget" in chat → handled in the same turn, confirmation shown (M12) |
| R1 | L5 Context | During F2: fetch few relevant memories → placed late in prompt (CM2) → memory_event "used" → UI "memory used" (M8) |
| D | L7/L6 | User deletes memory → hard delete; chat deleted → memories from it deleted (unlike Claude.ai, CA4); admin OFF → delete all with warning (MEM-4) |

## F7 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| MG1 | Two turns finish close together → same topic updated twice → per-user ordering + versioned update | Vendor (Cloud Tasks unordered) + ArcNave | MVP |
| MG2 | Learn only from user's own words (poisoning guard) | ArcNave (M11) | MVP |
| MG3 | Don't learn from blocked/refused turns | ArcNave (A6) | MVP |
| MG4 | Sensitive topics only with user opt-in | Vendor (Claude) – MEM-5 | MVP |
| MG5 | Explicit remember/forget works immediately + visible confirmation | Vendor (OpenAI) – M12 | MVP |
| MG6 | "Memory used" indicator on answers | Vendor (Gemini) – M8 | MVP |
| MG7 | Chat delete deletes its derived memories (Claude.ai keeps them – we don't, DPDP) | Vendor (Claude) + AS-D4 | MVP |
| MG8 | Expiry (TTL) cleanup job daily | Vendor (Memory Bank) – M5 | MVP |
| MG9 | Skip extraction for very short/trivial turns (cost) | ArcNave | MVP (MD-3) |
| MG10 | Project chats: which memory? | Vendor (Claude: per-project memory; ChatGPT: project-only for shared projects) | MD-1 |
| MG11 | Tanglish/Hindi extraction quality eval | ArcNave (M14) | MVP offline |

## F7 Claude-only
| # | Fact | Rec |
|---|---|---|
| CM1 | Claude memory tool exists on Vertex (N17) but is Claude-only | Use our own provider-neutral memory (M10) |
| CM2 | Memory text changing early in prompt breaks Claude cache + thinking prefix | Place memory late (latest turn) |
| CM3 | Refused turn must be removed from Claude history (A6) | Also never a memory source (MG3) |

## F7 decisions
| ID | Question | Rec |
|---|---|---|
| MD-1 | Memory in project chats | MVP: user's normal memory; project-only memory later |
| MD-2 | Explicit remember/forget | Immediate, in same turn, with confirmation |
| MD-3 | Skip trivial turns | Yes |
| MD-4 | Extractor model | Cheap Gemini Flash (final in Stage 11) |

## F8 – Delete
Delete types: chat · file · memory (F7) · project · user account · company offboarding · auto-retention (DM-10) · admin memory OFF (MEM-4)

| Step | Layer | What happens (chat delete example) |
|---|---|---|
| 1 | L1 | Confirm dialog ("cannot be undone") |
| 2 | L3 | Ownership (R12) |
| 3 | L7 | One tx: deleted_at (hidden everywhere: lists, search, retrieval, projects), cancel running turn, revoke share links, deletion_ledger entry (outside DB – DM-5) |
| 4 | L6 | Cascade job (resumable, idempotent): messages, contents, model_call_blocks, citations, summaries, attachments → files only used by this chat (reference count) → GCS objects + derivatives + chunks/embeddings → derived memories → Redis keys → feedback/safety content (IDs kept) → share snapshots |
| 5 | L6 | Verification sweep against data map (R8) → ledger completed ≤23 days |
| 6 | Infra | GCS soft delete (7 d) + DB backups/PITR (7+7 d) age out → total ≤30 days; any restore re-applies ledger (R7) |

## F8 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| XG1 | Hidden immediately everywhere (incl. search + retrieval) | ArcNave (DM-1) | MVP |
| XG2 | Running turn / queued jobs for deleted chat stopped (tombstone check) | ArcNave (AS20) | MVP |
| XG3 | Shared/deduped file (UD-1) deleted only when no chat/project uses it (reference count) | ArcNave | MVP |
| XG4 | GCS soft delete + DB backups fit inside 30 days | Vendor (GCS, Cloud SQL) – D9, D18 | MVP |
| XG5 | Restore from backup → ledger re-applied | ArcNave (R7) | MVP |
| XG6 | Model providers keep nothing long-term (stateless, DFR1); Google short caches/abuse logs + grounding logs ≤3 days → privacy policy | Vendor (Google, U4) | MVP disclosure |
| XG7 | Logs keep IDs only → nothing to delete there | ArcNave (D19) | MVP |
| XG8 | Usage/billing records (IDs, tokens, amounts – no content) kept for legal/tax period | ArcNave – lawyer to confirm | MVP (XD-4) |
| XG9 | User account delete = admin action (RV-1); user gets "request deletion" button → admin notified | ArcNave (RV-1) | MVP (XD-3) |
| XG10 | Company offboarding: export first (DM-12), then full purge incl. GCS prefix + backups age-out | ArcNave | MVP |
| XG11 | Auto-retention job (DM-10) runs daily using same cascade | Vendor (Claude/Gemini Enterprise retention) | MVP |
| XG12 | DPDP Rule 8(3) one-year retention → legal-hold switch (DF-6) | Vendor (MeitY) – lawyer | MVP switch |
| XG13 | Completion record in audit log (no content) | Vendor (Claude/ChatGPT audit) | MVP |
| XG14 | Undo / trash bin | Real products: delete is final (Claude, ChatGPT) | XD-1 |
| XG15 | Project delete → what happens to its chats | ArcNave | XD-2 |

## F8 Claude-only
| # | Fact | Rec |
|---|---|---|
| CX1 | Claude on Vertex is stateless (we send history each call) → nothing to delete at Anthropic | Disclose: Google is processor for Vertex |
| CX2 | Claude prompt cache can hold a prefix up to 1 h (org-level on Google Cloud) | Mention in privacy policy as transient cache |
| CX3 | Claude.ai deletes chats ≤30 days but keeps memories from deleted chats (CA4/CA5) | We delete memories too (stricter) |

## F8 decisions
| ID | Question | Rec |
|---|---|---|
| XD-1 | Trash / undo | No trash in MVP; confirm dialog; delete final |
| XD-2 | Project delete | Deletes project files + instructions; chats inside also deleted (warning shows count) |
| XD-3 | User account delete | Admin-run; user "request deletion" button notifies admin |
| XD-4 | Billing records | Keep IDs/amounts only (no content) for legal period – lawyer to confirm |

## Doc-sync 2026-10-12 (Stage 21 Task 1.11 brief – F1 step 6 and F2 as designed)
- **F1 step 6:** the api enqueues the Cloud Task after COMMIT and before the 202 (R10 inline); body ids only (AS3); task name = a digest of the turn id (AS16 / FG8 dedupe); OIDC caller `arcnave-tasks`; dispatch deadline N-44 15 min. **FG8 sweeper re-enqueue is deferred to the worker task** – until then a turn whose enqueue finally failed ends by the dispatch grace (N-73 60 s) as `interrupted`.
- **F2 as built:** the executor handles one delivery: `queued` → lease (GG1 / GG2 unchanged); a `running` turn with a live lease → wait ≤ 40 s, then 2xx if it is still renewed; a lease run out → one resume (`turns.resumes`) or the lazy path; handled ends → 2xx (GG3), SIGTERM / pre-lease errors → 500. GG7: every resumed path keeps the earlier partial text.
