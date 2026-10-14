# ArcNave – Lawyer / legal check list (consolidated)
_Created 2026-10-03 from all stage docs. Not legal advice; items for the company's lawyer before launch._

| # | Item | From |
|---|---|---|
| LW-01 | DPDP roles: customer company = data fiduciary, ArcNave = processor (contract / DPA template); user deletion via company admin (RV-1, XD-3) | S4 RV-1 |
| LW-02 | Storage India-only (product requirement) + AI processing outside India (Vertex global, Claude) – privacy policy + contract wording (C2, C3) | S1 |
| LW-03 | Grounding with Google Search / Web Grounding for Enterprise excluded from Google data-residency terms; Google keeps logs ≤3 days (standard) – disclosure | S4 B7, S8 |
| LW-04 | Grounding sub-call pattern (our web_search tool runs a grounding-only Gemini call and passes snippets to the main Gemini call) vs grounding terms (no cache / analyse) | S8 TD-2b |
| LW-05 | Research mode: storing our model's notes derived from Google-grounded results (RG1) | S10 |
| LW-06 | Normal chat: storing Gemini-grounded web_search snippets in chat history (terms: chat history text ≤2 years; show only to asking user) | review G-G |
| LW-07 | Claude web_search processed by Brave (third party) outside residency – privacy notice | S8 TD-21 |
| LW-08 | DPDP Rule 8(3): 1-year retention of personal data / traffic / logs for Seventh-Schedule purposes incl. processors (~May 2027) vs 30-day deletion → legal-hold switch DF-6; ids-only logs | S5, S11 |
| LW-09 | XD-4 billing/usage records retention period (IDs/amounts only) | S5 |
| LW-10 | D6: removal of deleted-file text from earlier chat turns – DPDP erasure "reasonable time" | S12 |
| LW-11 | SEBI: stock buy/sell/hold = regulated advice (PT-3 rule) | S6 |
| LW-12 | SPDI Rules 2011 relevant until DPDP §43A omission (~13 May 2027) | S6 |
| LW-13 | Anthropic AUP AI-disclosure for internal B2B use; MeitY Mar 2024 advisory labelling; SGI rules (Feb 2026) realistic audio/visual | S6 LG-1 |
| LW-14 | PT-2 high-risk decisions about individuals – human-review workflow requirement | S6 |
| LW-15 | Anthropic skills docs: learning-only approach (viewing OK, no copy/adapt) | S8 TD-11 |
| LW-16 | MEM-PEOPLE: third-party (colleague) data inside user memory; DPDP consent model | S11 |
| LW-17 | Public share links (company admin can enable) – terms; noindex | S5 SHD-1 |
| LW-18 | Self-signup terms of service, acceptable-use policy, company owner responsibility (G-B) | review G-B |
| LW-19 | Breach notification 72 h process (DPDP Rules) – runbook owner | S4 L7 |
| LW-20 | @wuba/react-native-echarts licence conflict (LICENSE Apache-2.0 vs package.json MIT) – confirm on pinned release before use; ECharts Apache-2.0 notices | S14 RD-3 |
| LW-21 | Google Search Suggestions display terms compliance (exact rendering, same width, direct tap) + hidden on share | S14 RD-7 |
| LW-22 | DPDP Rules 2025 commencement map (most duties ≈ May 2027); processor contract template; consent/notice text | S16 |
| LW-23 | DPDP Rule 8(3) one-year retention of personal + traffic data vs 30-day erasure; ids-only sufficiency; legal_hold scope | S16 SD-13 |
| LW-24 | CERT-In 2022 Directions: ArcNave provider class, 6-h incident reporting, 180-day logs | S16 |
| LW-25 | IT Rules 2021/2026: intermediary status for enterprise-only AI; grievance officer + SLAs; SGI non-applicability for text | S16 |
| LW-26 | Cross-border disclosures: Vertex global, Brave (Claude search), reCAPTCHA Enterprise | S16 |
| LW-27 | ToS: 18+ users, AUP flow-down, high-risk human review (PT-2), owner responsibility, appeal process | S16 |
| LW-28 | IndicGuard dataset upstream licence review for red-team use | S16 |
| LW-29 | SEBI (IA AI disclosure) / RBI FREE-AI sector addendum – Later | S16 |
| LW-30 | Anthropic Vertex guide "≥30-day request/response activity logging" recommendation vs ArcNave no-content telemetry rule; content re-screenable from DB as substitute (OD-18) | S17 |
| LW-31 | Alert/on-call/status-page vendors hosted in US (PagerDuty, Instatus/Statuspage) receiving content-free payloads – acceptable under DPDP + customer contracts? | S17 |
| LW-32 | Google Cloud audit logs contain principal emails (staff / customer admins) – retention 400 d in India buckets; notice wording | S17 |
| LW-33 | DPDP Rule 6(1)(e) "logs and personal data one year" – scope vs telemetry retention table (app logs 30 d, traces 30 d, audit 1 y) | S17 |
| LW-34 | CERT-In 180-day ICT log classes – confirm ids-only app/security logs in asia-south1 satisfy | S17 |
| LW-35 | GST: Google Cloud India (18 %) vs Google Asia Pacific (0 % with GSTIN, reverse charge by recipient) – invoicing entity, input credit | S18 |
| LW-36 | Claude on Vertex = Google "Separate Offering" with model-card terms – contract chain to college customers | S18 |
| LW-37 | Email provider DPA (SES / Zoho) for verification mails carrying user email addresses | S18 |
| LW-38 | Annual college contract: price-revision-at-renewal clause (Gemini 2027 price change), pooled-usage terms, season boost, student personal data in uploaded accreditation documents (DPDP) | S18 |
| LW-39 | Claude GLOBAL processing may include Singapore/US/EU – disclosure text (extends LW-26) | S19 |
| LW-40 | Cloud Armor / ALB request logs contain IPs + URLs (personal data) – retention + privacy notice | S19 |
| LW-41 | THIRD_PARTY_NOTICES register + copyleft process-boundary memo (LibreOffice MPL, ClamAV GPL via socket, FFmpeg LGPL build) | S20 |
| LW-42 | IndicGuard dataset CC-BY-4.0 attribution + Gemma base terms for the Apache adapter | S20 |
| LW-43 | Semgrep Rules License 1.0 (internal business use) if Semgrep adopted | S20 |
| LW-44 | DPAs + subprocessor review: Amazon SES, Zoho ZeptoMail, Zoho Desk | S20 |
| LW-45 | ArcNave subprocessor list for customers (Google Cloud, SES/Zoho, PagerDuty, status page, GitHub for code) | S20 |
| LW-46 | Document AI OCR release-candidate version (`pretrained-ocr-v2.1.1`, Google "Preview") used in production in Mumbai – pre-GA terms (no SLA, may change) acceptable? disclosure? (ADR-0006) | S9 / ADR-0006 |
| LW-47 | Vertex AI Ranking API on `global`: rerank passages (customer file text) processed outside India; Google publishes no Ranking-API-specific storage / logging statement (Agent Search data governance: not used for training) – privacy notice / subprocessor wording (ADR-0007) | S12 / ADR-0007 |
| LW-48 | Company offboarding: pseudonymous `audit_event` rows (ids, codes, HMAC hashes; no names / content) kept ≥ 1 year after the company's data purge for security investigation (owner decision B1, 2026-10-08) – lawful under DPDP as processor? retention wording in the DPA / privacy notice | S5.3 / LD-2 |
| LW-49 (HIGH – before Phase 2 file upload) | Children's data (DPDP: child = under 18) – students' data uploaded by college staff; Fourth Schedule Part A item 3 (educational institution exemption) – does it cover attendance / marks / profiles and ArcNave as processor; DPA wording; government polytechnics s.7; no tracking / profiling / ads (our design) – merged from the 2026-10-09 addendum | ADR-0010 review 2026-10-09 |
| LW-50 | Passwordless invite-only sign-in: ToS / AUP accepted by the owner (contract) and by each invited user at first sign-in; acceptance record; LW-18 obsolete – merged from addendum | ADR-0010 |
| LW-51 | Government / law-enforcement data-request policy (IT Act s.69 / 69B, CERT-In, DPDP s.17) – merged from addendum | Docs review 2026-10-09 |
| LW-52 | Report-content + copyright / IP complaint process and online-safety contact (IT Rules 2021) – merged from addendum | Docs review 2026-10-09 |
| LW-53 | Responsible-disclosure policy + `security.txt` safe harbour – merged from addendum | Docs review 2026-10-09 |
| LW-54 | College-specific terms + DPA (education: data ownership, student data clauses, export / deletion on exit) – merged from addendum | Docs review 2026-10-09 |
| LW-55 | **Anthropic as direct subprocessor (ADR-0012):** Anthropic commercial terms + DPA for the first-party Claude API; retention of prompts / outputs on the first-party API and whether zero-data-retention is available to us; no training on customer data; contract chain to colleges. Replaces the Vertex-specific LW-36 ("Separate Offering") and LW-30 (Vertex guide logging recommendation) for Claude | ADR-0012 |
| LW-56 | Claude `inference_geo` `global` (any geography; `us` option only) – cross-border transfer under DPDP s.16, privacy-notice / DPA wording (extends LW-02 / LW-26 / LW-39); in-India model processing available only through Amazon Bedrock's India endpoint (future option) – does any customer class (government, colleges) need it? | ADR-0012 |
| LW-57 | Subprocessor list (LW-45) adds **Anthropic PBC** (Claude API) and keeps Google Cloud for Gemini | ADR-0012 |
| LW-58 | **Router on Claude Haiku 5.5 (ADR-0013):** every company's user message (and the previous user message) is sent to Anthropic for routing, also for companies with the Claude switch off (the switch is a cost switch – owner 2026-10-12). Privacy notice / DPA / sales wording must not promise that "Claude off" means no processing by Anthropic (extends LW-55 – LW-57) **Extended 2026-10-13 to worker jobs (ADR-0014):** the first user message and first answer of every chat (≤ 1,500 characters, title job) and, from Task 1.14, the older turns of long chats (summary job) also go to Anthropic, for every company whatever its Claude switch | ADR-0013, ADR-0014 |
| note 2026-10-09 | Zoho ZeptoMail dropped (FD-33): LW-37 / LW-44 cover Amazon SES only (+ Zoho Desk if adopted) – merged from addendum | FD-33 |
