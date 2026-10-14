# ArcNave – Stage 1: Requirements
_Last updated: 2026-09-30 · Status: LOCKED_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - File types: add **CSV, TXT, MD** (Stage 9 G32). Macro (.docm/.xlsm/.pptm) and legacy (.doc/.xls/.ppt) files rejected with a "save as" message.
> - Claude budget "₹1,000/month total" replaced by RT-7: per-company monthly Claude limit set by the ArcNave team (Stage 7).
> - Memory: document memory, in-turn saves, default ON (Stage 11 checkpoint).


> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - **Owed items applied:** Billing/plans/payment = out of MVP scope (manual invoicing by ArcNave team; plan limits in company_settings) – review G-C. Self-signup in MVP (review G-B). R12 "₹1,000/month" fully replaced by RT-7 per-company limit.

> **Doc-sync 2026-10-03 (Stage 18) – see Stage-18-Cost-Performance/00-checkpoint-stage18.md + 00-Handoff/00-cost-decision-log.md:**
> - **Customer segment = colleges** (NBA / AICTE / NAAC accreditation work + staff research), sold **per college** (~50 staff accounts, pooled usage, annual invoice, college-admin self-signup + staff join). "Company" in all docs = institution. Cost basis: worst case 25 turns/staff/day (50 peak), peak-day ceiling ₹350/user (GST incl., 2027). Plan under validation: ₹50,000/month per college, 5,000 pooled turns (+5,000 season boost), Claude add-on ₹2,000, Research 5 runs (FD-16…FD-19).

> **Doc-sync 2026-10-03 (segment revision FD-21) – see 00-Handoff/00-cost-decision-log.md:**
> - **Owner decision 2026-10-03: ArcNave launches as a general-purpose B2B assistant for Indian companies; academics (colleges, NBA/NAAC/AICTE accreditation) is the first vertical to add one by one once the platform is stable.** The college analysis (FD-16…FD-19) is parked as that vertical's cost case. Kept generically for every company: pooled turns per company + season boost + Claude add-on pool + per-user soft cap (N-30), quotas N-11/N-18, annual invoice option.

## 1. Decided (user confirmed)
| # | Area | Requirement |
|---|------|-------------|
| R1 | Customers | B2B – companies (not public consumers) |
| R2 | Scale (first 6 months) | ~50 users × ~50 requests/day = ~2,500 requests/day (~75,000/month). This is a STARTING ESTIMATE for cost sizing, NOT a limit. Architecture must scale up without redesign. |
| R3 | Composer inputs (MVP) | Text prompt, file upload, mic (voice input), model selection by user |
| R4 | Models (MVP) | Gemini + Claude, both via Vertex AI |
| R5 | File types (MVP) | PDF, DOCX, XLSX, PPTX, images, audio, ZIP |
| R6 | Priority | Fast reply (latency > cost) |
| R7 | Market | Indian customers first |
| R8 | Memory | Required in MVP |
| R9 | Build | Coding done with Claude Code |
| R10 | Cloud | Google Cloud only (full Google stack is OK) |
| R11 | Data residency (O1) – REVISED 2026-09-30 | Customer data STORAGE stays in India (Mumbai). AI processing may use Vertex GLOBAL endpoint for all models (Gemini + Claude); disclosed in documentation (privacy policy + contract) |
| R12 | Claude budget (O2) | ₹1,000 / month maximum for Claude usage |
| R13 | Login (O4) | Email + password, and Google login |
| R14 | Growth target | ~5,000 users within 1 year (≈100× starting load; ~250,000 requests/day if usage pattern stays same) |
| R15 | Platforms | Web app + Android app (iOS later) |

## 2. Documented facts (verified 2026-09-30, official docs)
- F1. GCP Free Trial = $300 credit valid for 90 days. After 90 days or $300 spent, trial billing account closes; 30-day grace, then resources deleted.
- F2. Free Trial eligibility: never a paying GCP user AND never had the Free Trial before.
- F3. Trial $300 credit cannot pay for generative AI partner models (MaaS) → Claude on Vertex is NOT covered. No Marketplace on Free Trial.
- F4. Gemini 2.5 Pro / 2.5 Flash / 2.5 Flash-Lite are listed for Mumbai (asia-south1).
- F5. Vertex "global" endpoint: processing region cannot be controlled; endpoints alone do not guarantee data residency.
- F6. Claude multi-region endpoints on Vertex: US and EU only.
- F7. Claude on Vertex is NOT available in asia-south1 (Mumbai). Checked model cards: Haiku 4.5 (us-east5, europe-west1, asia-east1, global), Sonnet 4.5 & 4.6 (us-east5, europe-west1, asia-southeast1, global), Sonnet 5 (US/EU multi-region, global; ML processing Asia = asia-southeast1). Nearest = Singapore (asia-southeast1).
- F8. Claude list prices (Anthropic): Haiku 4.5 $1 in / $5 out per 1M tokens; Sonnet 4.5/4.6 $3 / $15; Sonnet 5 & 5.5 $2 / $10. On Google Cloud, regional and multi-region endpoints cost +10% over global.

Sources: docs.cloud.google.com/free/docs/free-cloud-features ; docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations ; Vertex Claude model cards (haiku-4-5, sonnet-4-5, sonnet-4-6, sonnet-5) ; platform.claude.com/docs/en/about-claude/pricing

## 3. C1 – RESOLVED (see Decision log)
- C1. R11 (India-only processing) + F7 (no Claude in Mumbai) → Claude cannot be used if the rule is strict.
  - Option A: Strict India – Gemini only in MVP; Claude off.
  - Option B: Data stored in India; Claude requests processed in Singapore (asia-southeast1 regional endpoint), clearly labelled.
  - Option C (recommended): Per-company setting. Default = India-only (Gemini). Company admin can opt in to Claude (Singapore processing).
  - Legal note: whether B/C is allowed for a given customer depends on that customer's contract and Indian law (DPDP). Not legal advice – confirm with a lawyer.

## 4. Budget reality check (estimate)
Assumption: normal chat request ≈ 2,000 input + 500 output tokens, regional endpoint (+10%). File requests use far more tokens.
| Model | Approx cost / request | Requests per ₹1,000 (~$11) |
|---|---|---|
| Claude Haiku 4.5 | ~$0.005 | ~2,200 |
| Claude Sonnet 5 | ~$0.010 | ~1,100 |
| Claude Sonnet 4.6 | ~$0.015 | ~750 |
Total expected load ≈ 75,000 requests/month → Claude can serve only ~1–3% of traffic.
→ Gemini must be the default for almost everything. Claude = limited option with per-company quota and a hard app-side stop (GCP budget alerts only alert; they do not stop spending).

## 5. NOT VERIFIED
- V2. The "6 months" promo credit – different from standard 90-day Free Trial? → Billing → Credits page (expiry + covered services).
- V3. Exact Vertex AI price for Claude (Vertex pricing page) – assumed same as Anthropic list price + 10% regional.

## 6. Assumptions (to confirm)
- A1. Multi-tenant: many companies on one platform; each company's data (chats, files, memory) isolated.
- A2. Each company has admin + normal users (roles).
- A3. "Fast reply" = streaming; first words in ~1–3 s for normal chat. File/ZIP tasks can take longer with progress shown.
- A4. Peak ≈ 3–5× average (IST office hours) → ~10–20 requests/minute peak.
- A5. Mic = speech-to-text into composer (not live voice conversation) in MVP.
- A6. Memory = per-user, inside a company (never shared across companies).

## 7. Open decisions
- O3. Memory design: decide at Stage 11 after comparing Claude / ChatGPT / Perplexity / Gemini memory (official docs) vs Vertex Memory Bank vs custom.
- C1. RESOLVED.

## 8. Recommendations (ArcNave design)
- ONE main GCP project + ONE paid billing account for production.
- Primary region: asia-south1 (Mumbai) for app, database, files. Model calls via global endpoint (C2, C3).
- Default model = Gemini. Claude = opt-in, quota-limited, hard-capped.

## 9. Decision log
- 2026-09-30 · C1 partial: Option A (strict India, no Claude) REJECTED – Claude allowed to process outside India (Singapore). Disclosure goes in documentation (privacy policy / customer contract), NOT on screen. Pending: B (all companies) vs C (per-company admin toggle).
- 2026-09-30 · C1 FINAL: Store ALL customer data in Mumbai (asia-south1) only. Processing: Gemini in Mumbai; Claude in Singapore (asia-southeast1) regional endpoint. Claude is a per-company admin ON/OFF switch (Option C), default OFF. Documentation (privacy policy + customer contract) states that when Claude is used, chat/file/memory content is processed in Singapore. No Singapore storage.
- 2026-09-30 · Stage 1 LOCKED.
- 2026-09-30 · C2 OPENED: Claude docs – regional endpoints only for Sonnet 4.6 and earlier; newer Claude (Sonnet 5/5.5, Opus 5.x) only via global or US/EU multi-region. Singapore (asia-southeast1) has Sonnet 4.5/4.6; Haiku 4.5 regional in Asia = Taiwan (asia-east1), not Singapore. C1 limits ArcNave to Sonnet 4.5/4.6 in Singapore. Decision needed.
- 2026-09-30 · C2 DECIDED (Option B): Claude calls use Vertex GLOBAL endpoint (newest models e.g. Sonnet 5.5; no 10% regional premium). Processing location for Claude is NOT fixed (Google routes). Storage stays Mumbai-only. Gemini stays Mumbai regional. Claude stays per-company admin switch (default OFF). Documentation must say: "When Claude is used, content is processed outside India; location is not fixed." Supersedes Singapore part of C1.
- V4 (NOT VERIFIED): confirm chosen Claude model (e.g., Sonnet 5.5) is enabled on global endpoint in our project's Model Garden.
- 2026-09-30 · C3 OPENED: Official GCP data-residency docs – India ML-processing guarantee only for Gemini 2.5 Flash (128K). No India guarantee for embeddings, reranker (global only), Chirp 3 speech; Document AI OCR in Mumbai is Preview, Layout Parser absent. R11 cannot be met with managed Vertex services except Gemini 2.5 Flash. Options: S strict (Gemini 2.5 Flash for all LLM/speech/OCR roles + self-hosted open-source embedding & reranker in Mumbai); R relaxed (use non-guaranteed Mumbai endpoints/global ranker, disclose in docs like Claude); H hybrid. Decision needed.
- 2026-09-30 · C3 DECIDED (Option R): Global endpoint OK for ALL AI models (not only Claude). Storage remains Mumbai-only. Managed services allowed: Vertex embeddings, Ranking API (global), Chirp 3 / Gemini audio, Gemini vision / Document AI. Documentation must state AI processing may occur outside India.
- 2026-09-30 · Models ready in user's project: Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5 (all via global endpoint).
- FACT (verified): Gemini 3.8 Flash – GA; endpoints global + us/eu multi-region (ML processing us/eu); 1,048,576 context; 65,536 max output; inputs text/image/audio/video/PDF; function calling, structured output, context caching, Google Search grounding, code execution, URL context, RAG Engine. Price (global): $0.75 in / $3.75 out per 1M until 31 Dec 2026, then $1.50 / $7.50 from 1 Jan 2027; cached input $0.075 → $0.15; non-global +10%.
- FACT (verified): On Google Cloud – Claude Sonnet 5.5 $2 / $10; Claude Opus 5.5 $4 / $20 per 1M (global); regional/multi-region +10%.
- COST FLAG: ~75K requests/month × (2K in + 500 out) on Gemini 3.8 Flash ≈ $250/month now, ≈ $500/month from Jan 2027 (estimate; detail in Stage 18). $300 trial credit would last ~1 month.
