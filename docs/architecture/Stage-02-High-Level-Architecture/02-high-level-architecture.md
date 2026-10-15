# ArcNave – Stage 2: High-level Architecture
_Last updated: 2026-09-30 · Status: LOCKED_
_Based on: 01-requirements.md (LOCKED)_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - **3 deploys** (Stage 4 L4 lock): API service (REST + SSE relay from Redis) · Turn Executor (Cloud Tasks; runs each answer, checkpoints, resumes) · Background worker. Plus web (Next.js) on Cloud Run.
> - Long work >10 min (research mode, whole-document map-reduce) runs as Cloud Run jobs with checkpoints (Stage 10 AO-4).
> - Isolated services: code sandbox runner (Stage 8 TD-4b) and parser sandbox (Stage 9 G34), no egress, no secrets.


> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - Rule 6 "₹1,000 total" → per-company monthly Claude limit (RT-7) + ArcNave-wide spend caps (PL-6).

## 1. Big picture (one line)
User → Web App → Auth → ArcNave API → **Orchestrator** (brain) → Model Gateway → Gemini (global endpoint) / Claude (global endpoint) → streamed answer → validated → saved in Mumbai → shown on screen.

## 2. Diagram
```
                        ┌──────────────────────────────┐
  User (browser) ──────►│ 1. Web App (Composer UI)     │  text · file · mic · model picker
                        └──────────────┬───────────────┘
                                       │ HTTPS + streaming
                        ┌──────────────▼───────────────┐
                        │ 2. Auth (email/pwd + Google) │
                        └──────────────┬───────────────┘
                        ┌──────────────▼───────────────┐
                        │ 3. ArcNave API (entry point) │
                        └──────────────┬───────────────┘
                                       │
  ┌────────────────────────────────────▼─────────────────────────────────────┐
  │ 4. ORCHESTRATOR  (controls every request, step by step)                  │
  │   a. Tenant policy + quota/budget guard  (company, role, Claude ON/OFF)  │
  │   b. Context assembly  (history + memory + retrieval + file extracts)    │
  │   c. Model routing     (which model, which region, fallback)             │
  │   d. Tool execution    (when model asks for an action)                   │
  │   e. Output validation (check before showing / saving)                   │
  └───┬──────────┬───────────┬───────────┬───────────┬──────────────┬────────┘
      │          │           │           │           │              │
  ┌───▼───┐ ┌────▼────┐ ┌────▼────┐ ┌────▼────┐ ┌────▼──────┐ ┌─────▼────────┐
  │5 Model│ │6 File   │ │7 Speech │ │8 Memory │ │9 Retrieval│ │10 Tools      │
  │Gateway│ │Processing│ │to Text  │ │Service  │ │Service    │ │Service       │
  └─┬───┬─┘ │(async)  │ └─────────┘ └─────────┘ └───────────┘ └──────────────┘
    │   │   └─────────┘
    │   └──► Claude  – Vertex global endpoint · only if company switch ON
    └──────► Gemini  – global endpoint · default

  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 11. DATA (all in Mumbai): App DB · File storage · Vector index · Memory   │
  └──────────────────────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 12. Cross-cutting: Admin panel · Usage metering · Logs/monitoring ·      │
  │     Security (tenant isolation, encryption, secrets)                     │
  └──────────────────────────────────────────────────────────────────────────┘
```

## 3. Components (what each block does)
| # | Block | Job | Sync / Async |
|---|---|---|---|
| 1 | Web App + Mobile App | Composer UI, shows streaming answer, upload, mic, model picker (Claude hidden if company switch OFF) | – |
| 2 | Auth | Login (email/password + Google), sessions, company + role of user | Sync |
| 3 | ArcNave API | Single entry point; checks login token; starts request; streams reply back | Sync |
| 4 | Orchestrator | The brain. Runs the request lifecycle (Stage 3). Owns sub-steps a–e | Sync |
| 5 | Model Gateway | One common interface for all models. Adapters: Gemini (global endpoint), Claude (global endpoint). Adds fallback + token counting | Sync |
| 6 | File Processing | Upload → safety check → extract text/images from PDF, DOCX, XLSX, PPTX, ZIP, audio → chunks → index | Async (background) |
| 7 | Speech-to-Text | Mic audio → text into composer | Sync (short) |
| 8 | Memory Service | Save / fetch / delete user memory (design decided in Stage 11) | Sync read, async write |
| 9 | Retrieval Service | Find relevant parts of uploaded files / past chats for the question | Sync |
| 10 | Tools Service | Runs actions the model requests (search, calculations, etc. – Stage 8) | Sync |
| 11 | Data | App DB (companies, users, chats), File storage, Vector index, Memory store – ALL Mumbai | – |
| 12 | Cross-cutting | Admin panel (Claude switch, quotas), usage + cost meter, hard budget stop, logs, security | – |

## 4. Core design rules (ArcNave recommendations)
1. **Everything replaceable:** every model/vendor sits behind its own adapter. Changing Gemini version or adding a new model = change one adapter, not the whole system.
2. **Orchestrator is the only brain:** UI and API stay thin. All decisions (routing, context, tools, validation) in one place.
3. **Heavy work is async:** file extraction, ZIP unpacking, audio, memory writing run in background so chat stays fast (R6).
4. **Tenant ID on everything:** every DB row, file, vector, memory item carries company ID → isolation (A1).
5. **Mumbai-only storage; model calls via global endpoint** (decisions C2, C3 – disclosed in documentation).
6. **Budget guard before every Claude call:** app-side counter; stop when company quota or ₹1,000 total is reached.
7. **Stream first, save after:** user sees words immediately; validated final answer saved after stream ends.

## 5. Candidate Google Cloud services (NOT locked – verify at Stage 19/20)
| Block | Candidate |
|---|---|
| Web App hosting | Firebase Hosting / Cloud Run |
| Auth | Firebase Authentication / Identity Platform |
| API + Orchestrator + services | Cloud Run (asia-south1) |
| Background jobs | Pub/Sub or Cloud Tasks + Cloud Run jobs |
| App DB | Cloud SQL (PostgreSQL) or Firestore |
| File storage | Cloud Storage (asia-south1) |
| Vector index | pgvector (in Cloud SQL) or Vertex AI Vector Search |
| Speech-to-Text | Gemini audio input or Cloud Speech-to-Text |
| Secrets | Secret Manager |
| Logs / monitoring | Cloud Logging + Cloud Monitoring |

## 6. Assumptions (Stage 2)
- A7. DECIDED (user): MVP = web app AND mobile app. → ArcNave API must be one common API for both (API-first); mobile needs Google sign-in, streaming, file upload, native mic.
- A8. DECIDED (user): 1 codebase, 2 deploys – (1) API service: chat, orchestrator, streaming; (2) Background worker: file/ZIP/audio processing, memory writing. Split further later only if needed.

## 7. Open decisions (Stage 2)
- Mobile: DECIDED – Android only for now (iOS later).
- None. Stage 2 LOCKED 2026-09-30.
