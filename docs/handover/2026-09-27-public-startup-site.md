# ArcNave public product website

User scope: a credible public product page for Microsoft/Google startup-credit applications,
with signup/login leading to the existing authenticated workspace. Local review first.

Confirmed company facts: bootstrapped; in development; Coimbatore, Tamil Nadu, India;
contact admin@arcnave.tech; targeting a broader release by year-end 2026. No incorporation,
founder identity, investors, customer counts, prices, or partnerships have been confirmed.

Plan and tasks:
- Public /, /about, /privacy, /terms routes; workspace home moves to /app.
- Product positioning, clearly labeled interactive example, capabilities, workflow, FAQs,
  development stage, contact, and public data/use notices.
- Keep existing authentication API/session behavior; /signup opens signup and /login opens login.
- Preserve shared links and deep links. Update internal home navigation to /app.
- Separate public UI loading from the workspace; prerender public HTML for crawlers.
- Validate routes, existing frontend suite/build, desktop/mobile, and signup/login entry.
- Record browser evidence and readiness gaps. No application submission or deployment.

Official application references checked 2026-09-27:
- https://cloud.google.com/startup/benefits
- https://cloud.google.com/startup/faq
- https://learn.microsoft.com/en-us/startups/microsoft-for-startups/application

Page clarity does not establish eligibility or guarantee credits. Funding, company age,
business/domain verification and prior credits must match the application independently.

Final positioning: Academic Campus AI for colleges, IQAC, faculty, and administrators.
NAAC institutional preparation, NBA program preparation, and AICTE document readiness
are separate illustrative workflows. No official endorsement or approval guarantee.

Validation: full frontend suite 25 files / 183 tests passed before final campus copy changes;
focused homepage/auth suite 7 tests passed after campus copy changes. Desktop and 390px
phone inspected, no horizontal overflow. Existing backend database schema drift prevents
claiming authenticated end-to-end acceptance. Live registration is currently disabled;
signup has early-access contact handling. Production has not been changed.

## Layout and practical workflow correction

- At 899px the old stacked hero put the preview below the first screen. Use a compact two-column hero from 760px; preserve natural mobile scrolling and a common gutter across sections.
- Product now explains inputs, assisted work, draft outputs, and campus reviewers separately for NAAC, NBA, and AICTE.
- How it works includes a concrete IQAC request and source verification before human approval/submission. Official requirements linked; no automatic portal or compliance claims.
- Local focused public/auth tests pass (7). Browser checks include 899px and 390px widths.

## Visual redesign iteration

Grouped hero into a dark forest-green panel with a lime primary action, compact white preview, and deliberate type hierarchy. Product cards align and expose detailed inputs on demand. How it works uses a numbered four-step grid. Checked desktop, tablet and phone locally. This visual direction is available for review at port 5174; not deployed in this iteration.
