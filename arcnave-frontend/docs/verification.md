# Verification record

Validated on September 16, 2026.

## Automated checks

- Production TypeScript and Vite build passes.
- 15 Vitest checks pass across response streaming, cancellation, source integrity, scope filtering, workspace recovery, draft persistence, privacy preferences, file validation, and IndexedDB round-tripping.
- Dependency audit reports no known vulnerabilities.

## Browser checks

- Desktop at 1440 × 900: home, expanded and collapsed navigation, chat, sourced research, contextual source panel, artifact split view, projects, settings, and dark mode.
- Tablet at 768 × 1024: stable two-column home with no horizontal overflow.
- Mobile at 390 × 844: home, navigation drawer, chat, projects, settings, and full-screen contextual panels. The audited page had no horizontal overflow and no visible unnamed buttons.
- Keyboard access: skip link, `Ctrl+,` settings shortcut, menu/dialog Escape handling, focusable controls, and accessible labels.
- Runtime states: streaming, immediate cancellation, stopped response recovery, simulated network interruption, retry, empty lists, loading, and missing content.
- Persistence: projects, preferences, conversations, artifact versions, and unsaved artifact drafts survive panel closure and browser reload.

## Known integration boundary

The included adapter uses prepared sample responses and curated example sources. Live AI generation, real-time retrieval, authentication, sync, and cloud storage require backend services. Browser file selection could not be exercised end-to-end through the available Brave automation extension because its file URL permission was unavailable; file validation and IndexedDB storage are covered by automated tests, and the visible upload entry points were checked in the browser.
