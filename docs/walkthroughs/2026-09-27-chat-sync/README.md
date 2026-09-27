# Chat rendering and Git synchronization

Implementation plan: fetch main, preserve existing work in a named stash, fast-forward the
checkout, integrate the chat fixes with the upstream visual sandbox, validate both suites,
then commit and open a PR. Merge remains conditional on explicit deployment approval because
the enabled Cloud Build trigger watches main.

- [x] Sync main at `94deb57`, retaining all existing stashes.
- [x] Render single-dollar math while preserving currency and code.
- [x] Replace repeated generic follow-ups with optional context-derived actions and a separate composer hint.
- [x] Match the current user's language and script, including Latin-script Tanglish.
- [x] Bound answers to the composer column and refresh sidebar icons using existing Lucide icons.
- [x] Reject tool protocol leaked into answer text with a stable error code.
- [x] Retain upstream visual sandbox, voice dictation, styles, effort, previews, sharing and slides.
- [x] Browser acceptance with a scripted fake provider: calculator interaction, full screen,
  save-as-artifact interaction, reload persistence, rendered math, contextual suggestions,
  separate composer hint and equal 760px answer/composer widths without document overflow.
- [ ] Real-provider language and suggestion relevance acceptance.
- [ ] Main merge and automatic live deployment approval.

Screenshots: [chat](chat.png), [full screen](fullscreen.png), [artifact](artifact.png).
The screenshots validate UI plumbing with a fake provider; they do not establish real-model
language or relevance behavior. The original production protocol-leak cause is unconfirmed.

Validation: frontend 176 tests and production build passed. Backend typecheck, build and all
1075 tests passed in isolated Node 22 with Python and Poppler. The shared test database
was left intact; validation uses a separate database.
