# Google Start Tier public-site readiness

Scope: make `arcnave.tech` explain ArcNave's product, buyer, business model, roadmap,
independent startup identity, and development status accurately. Do not submit an
application or deploy without the owner's current-task approval.

## Confirmed by owner on 2026-09-28

- ArcNave founding date: 15 September 2025.
- No Google Cloud promotional/startup credits beyond free credits.
- Intended business model: recurring college/institution subscription. Pricing is not fixed.
- Plans to seek venture funding within 12 months.

These are owner statements, not independently verified records. The public site can state
the company and product facts, but the credit history belongs in the private application.
No billing account ID or account email is stored here.

## Implementation plan and task list

- [x] Verify current Start Tier requirements from Google Cloud's official Start, benefits,
  and FAQ pages.
- [x] Compare the public site and auth entry against the product-first reference.
- [x] Make the independent product company, initial customer, subscription intent, and
  planned roadmap clear without inventing pricing, customers, traction, or capabilities.
- [x] Align auth page copy and public HTML metadata with the campus product.
- [x] Validate frontend build, tests (195/195), prerendered HTML, and local desktop browser.
- [x] Verify 320px and 390px phone layouts in Chromium, including the mobile menu; no
  horizontal overflow at 320, 390, 768, or 1280px. About and login also fit at 390px.
  Screenshots: `arcnave-home-390.png` and `arcnave-menu-320.png` in this task's visuals.
- [x] Run backend typecheck and tests. Typecheck passed; tests finished 872 passed, 25 failed,
  10 skipped in this Windows environment. Failures include unavailable `pdftotext` and
  `python3`, and Windows process/newline behavior. No backend source changed.
- [ ] Capture a real authenticated product walkthrough before claiming a live working MVP.
- [ ] Verify the live domain, business email, and Google Cloud billing-account email match.
- [ ] Confirm the 18-character billing ID and founding-date evidence privately.
- [ ] Obtain owner approval before any live deployment; then verify the live site separately.

## Application facts to review before submission

ArcNave is an independent academic software startup serving college teams. Its current
product foundation includes accounts, conversations, projects, uploaded files, and editable
outputs. Initial workflows focus on preparing evidence-led drafts for NAAC, NBA, and AICTE
work, with college staff verifying sources and submitting through the official process.
The intended payer is the institution through a recurring subscription. Price is not set.
The product is in development and the public workflow preview is illustrative.

Do not claim production AI completion, live signup availability, paying customers, pilots,
revenue, partnerships, model availability, or an exact release date without a fresh check.
Do not imply ArcNave is affiliated with an accreditation body.

Google Cloud usage answer: The backend uses Vertex AI provider integrations and supports
Cloud Run execution for its service and isolated file-processing sandbox. Cloud Storage is
supported for file and temporary staging paths; PostgreSQL stores workspace data. Before
submission, confirm which storage and database options are actually active in production.
Do not list Cloud SQL, Secret Manager, or other services as current usage without evidence.

Official sources checked 2026-09-28:
- https://cloud.google.com/startup/pre-funded
- https://cloud.google.com/startup/benefits
- https://cloud.google.com/startup/faq

Product reference checked: https://claude.ai/ — the public page distinguishes product,
plans, company, policies, and account entry. ArcNave's page uses its own brand and college
workflow language. The Google application material and institutional positioning are
ArcNave-specific decisions; they are not presented as features of that reference.
