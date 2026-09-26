# Claude UI parity: implementation plan for handover

- Date: 2026-09-26
- Audience: a coding agent (Google Antigravity or any other) and the person reviewing its work.
- Source of the gap list: a feature-by-feature comparison of the Claude app (Claude Help Center,
  read 2026-09-26) against the ArcNave frontend and backend code at commit `dfdb8cd`.
- Rules: `AGENTS.md` and `CLAUDE.md` apply to every work package (WP).

## How every work package is done

1. **One WP per conversation, one branch per WP, one PR per WP.** A WP is sized to fit one agent
   conversation. Never combine two.
2. **Plan first.** Use Planning mode. The agent writes an implementation plan and task list, and
   the reviewer comments on it before code is written. A WP marked **ADR required** starts with
   an ADR in `docs/decisions/` (next number after the highest one there), and no code is written
   until the reviewer accepts it.
3. **Check "Current state" first.** Each WP states what the code does today, with file paths. If
   a statement is no longer true, the agent says so in its plan instead of guessing.
4. **Claude is the reference, not a source to copy.** Match the behaviour the Help Center
   describes. Never copy Anthropic's names, logos, icons, prompt text or fonts.
5. **Tests are part of the WP.** Every "Tests" item is written and passes. Tests never call a
   real model provider.
6. **Done means all of the following:**
   - `cd backend && npx tsc --noEmit && npx vitest run` is clean;
   - `cd arcnave-frontend && npm run build && npm test` is clean;
   - every acceptance check passes in a browser against the local stack, with a screenshot in
     the walkthrough;
   - `docs/openapi.json` is regenerated when a route changed;
   - `mistakes.md` and `docs/checkpoints/CURRENT.md` are updated;
   - the WP's checkbox below is ticked.
7. **Never deploy.** The user deploys after reviewing the PR.

## Status

| WP | Gaps | What | Phase | ADR | Done |
|---|---|---|---|---|---|
| WP-00 | 7 | Ship the LaTeX fix and language-rule removal | 0 | no | [x] |
| WP-01 | 5, 6 | Code block copy button; correct language in code artifacts | 1 | no | [x] |
| WP-02 | 2 | Mermaid diagrams in chat and documents | 1 | no | [x] |
| WP-03 | 17, 20 | More keyboard shortcuts; a readable (dyslexia-friendly) font | 1 | no | [ ] |
| WP-04 | 19 | Effort control in the composer | 2 | no | [ ] |
| WP-05 | 18 | Styles (presets + custom) | 2 | yes | [ ] |
| WP-06 | 3 | Clickable question options (single, multi, rank) | 2 | yes | [ ] |
| WP-07 | 4 | Select text in an answer or document and ask about it | 2 | no | [ ] |
| WP-08 | 15 | Incognito chats | 2 | yes | [ ] |
| WP-09 | 14 | Branch switcher `< 1/2 >` on edited prompts | 2 | yes | [ ] |
| WP-10 | 1, 8, 9 | Custom visuals in chat; interactive and SVG artifacts (sandbox) | 3 | yes | [x] |
| WP-11 | 13 | Word, Excel and PowerPoint previews | 4 | no | [ ] |
| WP-12 | 11, 16 | Public share links for chats and artifacts | 4 | yes | [ ] |
| WP-13 | 21, 22 | Memory import/export; full data export; account deletion | 4 | yes | [ ] |
| WP-14 | 25 | Connectors (remote MCP) | 5 | yes | [ ] |
| WP-15 | 26 | Skills settings: browse, turn off, add custom skills | 5 | yes | [ ] |
| WP-16 | 10 | Docs, Slides and Design artifact types | 5 | yes | [ ] |
| WP-17 | 12 | Save a created file to Google Drive | 5 | yes | [ ] |
| WP-18 | 27 | Voice dictation (then voice mode) | 5 | yes | [ ] |
| WP-19 | 23, 24 | Break reminders, quiet hours, monthly recap | 5 | no | [ ] |

Gap numbers refer to the comparison table given to the user on 2026-09-26. Phases run in order;
WPs inside one phase are independent unless a WP says otherwise.

---

## WP-00 — Ship what is already built (user action, not the agent)

- Branch `claude/tools-skills-architecture-jyxa61`, commit `dfdb8cd`:
  - LaTeX (`$$…$$`) typeset with KaTeX in chat (`arcnave-frontend/src/markdownPlugins.ts`);
  - the reply-language rule removed (the model chooses, as in Claude's app prompt).
- Merged to `main` on 2026-09-26. After deploy, check that a `$$` formula renders.

---

## WP-01 — Code block copy button and correct code language

- Gaps: 5, 6. Branch: `feat/wp-01-code-blocks`. Depends on: none.
- **Claude:** every code block in an answer has its own copy button and shows its language; a
  code artifact is highlighted in its own language.
- **Current state:**
  - `arcnave-frontend/src/Content.tsx` overrides `pre` only to add `tabIndex` (search for
    `pre: ({ children })`). There is no per-block copy.
  - `arcnave-frontend/src/Panels.tsx` renders a code artifact as
    ``"```javascript\n" + content + "\n```"``, so every language is coloured as JavaScript.
  - Artifacts store `kind` (`document|code|webpage`) and `title`, not a language.
- **Steps:**
  1. New component `arcnave-frontend/src/CodeBlock.tsx`: a header with the language name (from
     the `language-xxx` class that react-markdown puts on `code`) and a Copy button using
     `navigator.clipboard.writeText` on the block's plain text. The button shows "Copied" for 2 s
     and is keyboard reachable with an `aria-label`.
  2. Use it from the `pre` override in `Content.tsx` and in `generative-ui/blocks/TextBlock.tsx`
     (both go through `markdownPlugins.ts`; keep one shared `components` map there).
  3. In `Panels.tsx`, pick the language from the artifact title's extension (`.py` python, `.ts`
     typescript, `.tsx` tsx, `.js` javascript, `.sql`, `.sh` bash, `.json`, `.html`, `.css`,
     `.go`, `.java`, `.rb` ruby, `.rs` rust, `.cs` csharp, `.php`, `.yaml`/`.yml` yaml). With no
     known extension, pass no language and let `rehype-highlight` detect it (`detect: true`).
- **Tests:** a render test that a fenced `python` block shows "python" and a Copy button; a unit
  test for the extension map, including the no-extension case.
- **Acceptance (browser):** ask for a short Python and SQL snippet. Each block has its own Copy
  button that copies only that block. Create a code artifact titled `x.py`: it is coloured as
  Python.
- **Out of scope:** line numbers, word wrap toggle.

## WP-02 — Mermaid diagrams

- Gap: 2. Branch: `feat/wp-02-mermaid`. Depends on: WP-01 (shared components map).
- **Claude:** diagrams and flowcharts render as pictures (artifacts support Mermaid).
- **Current state:** no Mermaid anywhere. The main JS chunk is already over 500 kB (build warning).
- **Steps:**
  1. Add `mermaid`. Load it only when a ```` ```mermaid ```` block appears: `await import('mermaid')`.
  2. `arcnave-frontend/src/MermaidBlock.tsx`: `mermaid.initialize({ startOnLoad: false,
     securityLevel: 'strict', theme })` with the theme following the app's light or dark setting,
     then `mermaid.render(uniqueId, source)` and insert the returned SVG.
  3. While a message is still streaming, show the source; render once the block is closed (the
     closing fence has arrived) or the message is complete, debounced by 300 ms.
  4. A render error shows the source as a normal code block with one line, "Diagram could not be
     drawn", and never breaks the message.
  5. Buttons: "Diagram / Code" toggle, copy source, download `.svg`.
  6. Tell the model the UI renders this. Add one line to the runtime capabilities section in
     `backend/src/services/systemPrompt.ts` (the dynamic part, not `STATIC_BASE_SYSTEM_PROMPT_V1`):
     "The chat renders Markdown, `$$…$$` math with KaTeX, and ```` ```mermaid ```` diagrams."
- **Tests:** frontend, with the mermaid module mocked: a ```` ```mermaid ```` block calls
  `render`, and an error falls back to the source. Backend: the capabilities section contains
  the rendering line.
- **Acceptance (browser):** "draw a flowchart of user login" gives a drawn diagram. In dark mode
  it is readable. A deliberately broken diagram shows its source and the note. Opening a chat
  without diagrams does not download the mermaid chunk (Network tab).

## WP-03 — Keyboard shortcuts and a readable font

- Gaps: 17, 20. Branch: `feat/wp-03-shortcuts-font`. Depends on: none.
- **Claude:** Ctrl/Cmd+Shift+O new chat, Ctrl/Cmd+K search, Ctrl/Cmd+Shift+C copy the last
  answer; chat font can be Default, Match System or Dyslexic friendly.
- **Current state:**
  - `arcnave-frontend/src/App.tsx` handles Ctrl/Cmd+K (new conversation), +P (search), +, (settings).
  - The Settings shortcuts list is in `Settings.tsx`.
  - The font preference is `sans` or `serif`. `backend/src/routes/preferences.ts` accepts any
    string for `font` (`z.string()`).
- **Steps:**
  1. Add Ctrl/Cmd+Shift+O (new chat) and Ctrl/Cmd+Shift+C (copy the last complete assistant
     answer, with a toast). Keep the existing ones. Test in Chrome, Edge and Firefox. Where the
     browser keeps a combination for itself, say so in the shortcuts list rather than fighting it.
  2. Update the list in Settings.
  3. Add a font option `readable`. Self-host the font with an `@fontsource` package (Atkinson
     Hyperlegible or OpenDyslexic), with no external font CDN. Apply it through the same CSS path
     as `serif`.
  4. Trace every consumer of `preferences.font` first, then restrict the route to the values in
     use plus `readable`, with a typed 400 error for anything else.
- **Tests:** shortcut handler unit tests; a preferences route test that `readable` is accepted and
  an unknown value is rejected with its code.
- **Acceptance (browser):** each shortcut works, or is listed as browser-reserved. Choosing the
  readable font changes the chat text and survives a reload.

## WP-04 — Effort control in the composer

- Gap: 19. Branch: `feat/wp-04-effort`. Depends on: none.
- **Claude:** the person can change the model, effort and thinking settings (Help Center,
  "Change the model, effort, and thinking settings").
- **Current state:**
  - Effort comes only from the server setting `REASONING_EFFORT` (default `medium`, ADR-0032):
    `backend/src/services/generation.ts` calls `effortFor(modelSpec, this.cfg.REASONING_EFFORT)`.
  - `effortFor` in `backend/src/providers/capabilitiesTable.ts` steps down to a level the model
    supports.
  - `GET /models` does not return the supported levels. The generate body has `prompt, mode,
    model, attachmentIds, retryMessageId, codeExecution`.
- **Steps:**
  1. `GET /models`: add `reasoningEfforts: string[]` per model, from the capabilities table.
  2. Generate body: optional `effort` enum `low|medium|high|xhigh|max`, validated by the route
     schema. Generation uses `effortFor(spec, input.effort ?? cfg.REASONING_EFFORT)`.
  3. Record the effort actually used in the turn's debug trace (`timing.note('effort', …)`
     already exists) so the requested and applied levels can be compared.
  4. Preferences: `effort` column, nullable, meaning "server default". Migration via
     `npm run db:generate`.
  5. Composer: an effort menu next to the model menu, shown only when the chosen model supports
     two or more levels. It is labelled with what each level trades: speed against depth.
- **Tests:** route rejects an unknown effort; a turn with `effort: 'high'` on a model supporting
  only `low|medium` runs at `medium` and the trace says so; `GET /models` lists levels.
- **Acceptance (browser):** switching to High makes a hard question take visibly longer with a
  longer thinking block; Low is faster. The setting survives a reload.

## WP-05 — Styles

- Gap: 18. Branch: `feat/wp-05-styles`. Depends on: none. **ADR required** (prompt placement
  and cache impact).
- **Claude:** preset styles Normal, Concise, Explanatory, Formal, plus custom styles made from
  instructions or writing samples, picked from a "Use style" menu. A style changes how Claude
  writes, not what it knows.
- **Current state:** no styles. Account-wide instructions exist (`preferences.instructions`).
  The system prompt has a static, cached part (`STATIC_BASE_SYSTEM_PROMPT_V1`) and a dynamic part.
- **Steps:**
  1. ADR: the style text goes in the dynamic part inside `<style_instructions>`, after the static
     prefix, so the prompt cache prefix is unchanged. A style never overrides the language rule,
     truthfulness or file rules.
  2. `backend/src/services/styles.ts`: the four presets with ArcNave's own short wording (never
     Anthropic's). Normal adds nothing.
  3. Table `styles` (id, user_id, name ≤ 60, instructions ≤ 4000, version, timestamps); CRUD
     routes `/styles`; typed errors (`style_not_found`, `style_too_long`).
  4. Custom style from samples: the user pastes up to 3 samples. One model call (injectable
     provider, faked in tests) summarises them into instructions the user can edit before saving.
  5. Generate body: optional `styleId` (preset key or uuid). `preferences.styleId` remembers the
     last one.
  6. Composer: "Use style" menu with presets, custom styles and "Create & edit styles".
- **Tests:** the prompt contains the style block after the static prefix, and the static prefix
  is byte-identical with and without a style; an unknown `styleId` gives 404
  `style_not_found`; CRUD; the sample summariser uses the fake provider.
- **Acceptance (browser):** the same question with Concise and with Explanatory gives clearly
  different lengths. A custom style made from a pasted sample is applied.

## WP-06 — Clickable question options

- Gap: 3. Branch: `feat/wp-06-ask-options`. Depends on: none. **ADR required** (turn-ending tool).
- **Claude:** instead of asking the person to type, Claude can show multiple choice, multi-select
  or ranking options at the bottom of the chat, with typing still possible.
- **Current state:** no such tool. `messages.questions` (research follow-ups) is a different
  feature; leave it alone. Tool definitions live in `backend/src/tools/definitions.ts`; the loop
  policy is in `backend/src/providers/toolLoopPolicy.ts`.
- **Steps:**
  1. ADR: a tool `ask_user_options` that ends the turn. Its input is `{ question, kind:
     'single'|'multi'|'rank', options: [{ label, description? }] (2–6) }`. Its result is
     `{ status: 'shown' }`, and the loop ends after it without another model round. If the loop
     has no "terminal tool" idea, add one in `toolLoopPolicy.ts` with a test.
  2. The tool description says to use it only when the answer is one of a few known options,
     and at most once per turn. Do not add rules to the static prompt.
  3. Frontend: when the last assistant message ends with this tool call, show the options above
     the composer. Single sends the label as the next user message. Multi has checkboxes and Send.
     Rank has keyboard-usable up and down buttons and Send. The composer stays usable for a typed
     answer. Options disappear once any reply is sent.
- **Tests:** schema validation (too few or too many options); the loop stops after the tool;
  the options render and a click sends the label.
- **Acceptance (browser):** "help me plan a trip, ask me what you need" shows options; clicking
  one continues the conversation; typing instead also works.

## WP-07 — Select text and ask about it

- Gap: 4. Branch: `feat/wp-07-selection-ask`. Depends on: none.
- **Claude:** highlight part of a draft and ask for a change to that part, in place (release
  notes, 2026-06-12).
- **Current state:** nothing handles text selection in answers or artifacts.
- **Steps:**
  1. When the user selects text inside an assistant answer, a small floating button "Ask about
     this" appears. It puts the selection into the composer as a quote (`> …`), followed by an
     empty line, and focuses the composer.
  2. Inside a document artifact (preview tab), the button is "Change this". It sends a prompt
     that names the artifact and quotes the passage, asking to change only that passage. The
     model then uses `update_artifact`, which creates a new version, so the old version is kept.
  3. The button closes on Escape, on scroll, or when the selection is cleared.
- **Tests:** selection handling unit test (quote formatting, multi-line selection, ignoring
  selections outside answers).
- **Acceptance (browser):** select a sentence in an answer, click, and the composer holds the
  quote. In a document artifact, "Change this" on one paragraph produces a new version where
  only that paragraph differs (use the version history to compare).

## WP-08 — Incognito chats

- Gap: 15. Branch: `feat/wp-08-incognito`. Depends on: none. **ADR required** (retention).
- **Claude (Help Center, "Use incognito chats"):**
  - not saved to chat history and not found by chat search;
  - does not use existing memory and is not added to memory;
  - kept 30 days, then deleted;
  - only outside projects;
  - shown with a dark border, an "Incognito chat" label and a ghost icon.
- **Current state:**
  - `preferences.saveHistory` exists in the schema and route but nothing reads it. The ADR
    decides whether incognito replaces it or wires it.
  - Deleted chats are swept after 30 days by `backend/src/services/retention.ts`.
  - Memory is used in `backend/src/services/generation.ts` (`memoryEnabled`, the memory tool
    executor, and `distillUserStatement`). Chat search is the `search_chats` tool in
    `backend/src/tools/searchToolsExecutor.ts`.
- **Steps:**
  1. `chats.incognito boolean not null default false` (migration).
  2. `POST /chats` accepts `incognito`. With a `projectId` it is rejected with 400
     `incognito_not_in_project`.
  3. `GET /chats` and `search_chats` exclude incognito chats.
  4. Generation: for an incognito chat, memory is off for the whole turn. There are no memory
     tools and no memory in the prompt, and `distillUserStatement` is not called.
  5. `retention.ts`: delete incognito chats 30 days after creation, as a deleted chat is.
  6. Usage records are still written (billing and limits are real).
  7. UI: a ghost button on the empty new-chat screen, top right. The incognito chat has a dark
     border and an "Incognito chat" label. After the user leaves it, it is not in the sidebar.
- **Tests:** list and search exclusion; memory tools absent and distill not called (spy); the
  project rejection code; the retention sweep deletes a 31-day-old incognito chat and keeps a
  29-day-old one.
- **Acceptance (browser):** have an incognito chat that states a preference, open a normal chat,
  and memory does not know it. The incognito chat is not in the sidebar or search.

## WP-09 — Branch switcher

- Gap: 14. Branch: `feat/wp-09-branch-switcher`. Depends on: none. **ADR required** (supersedes
  the "editing a prompt branches into a new chat" note in `arcnave-frontend/src/workspace.tsx`).
- **Claude:** editing an earlier message creates another version of the conversation in the same
  chat, and `< 1/2 >` arrows switch between versions.
- **Current state:** `POST /chats/{id}/branch` copies the conversation up to the edited turn into
  a new chat, which appears as a separate sidebar row (`workspace.tsx`, `pendingEdit`). Nothing
  records which chat a branch came from.
- **Steps:**
  1. ADR: keep the copy-on-branch storage, which is safe and already tested. Add
     `chats.parent_chat_id` (on delete set null) and `chats.fork_seq` (the seq of the edited user
     message). The chats that share a root form a family.
  2. `POST /chats/{id}/branch` records both fields.
  3. `GET /chats/{id}` returns, for each user message seq that has versions,
     `versions: [{ chatId, createdAt }]` in creation order.
  4. `GET /chats` lists one row per family: the most recently updated member.
  5. Deleting the chat shown deletes only that version; the family stays.
  6. UI: on an edited user message, `< i/n >`. Switching loads that chat id without a full page
     reload and keeps the scroll position at the message.
- **Tests:** version listing for a message edited twice; family listing shows one row; delete one
  version keeps the others; migration is stamped after the latest existing migration.
- **Acceptance (browser):** edit a prompt twice, switch between 1/3, 2/3 and 3/3, and each shows
  its own answers. The sidebar has one row.

## WP-10 — Custom visuals, interactive artifacts and SVG artifacts

- Gaps: 1, 8, 9. Branch: `feat/wp-10-visual-sandbox`. Depends on: WP-02. **ADR required**
  (security). This is the largest risk in the plan. The reviewer checks the ADR line by line.
- **Claude (Help Center, "Custom visuals in chat"):**
  - Visuals are built with HTML, are interactive (buttons, sliders, full screen), and live inline
    in the answer.
  - They can be copied as an image, downloaded as `.svg` or `.html`, or saved as an artifact.
  - Clicking inside a visual can send a follow-up prompt.
  - Artifacts can be small interactive tools.
- **Current state:**
  - `render_ui` (`backend/src/tools/definitions.ts`) renders fixed block types only: text,
    table, metric, chart, comparison, timeline, steps, cards, sources, dashboard
    (`arcnave-frontend/src/generative-ui/`).
  - The webpage artifact preview in `Panels.tsx` uses `<iframe sandbox="">` with a CSP of
    `default-src 'none'`, so no script runs.
  - `artifacts.kind` has the check `('document','code','webpage')`.
- **Security design the ADR must fix in place (all of it):**
  - Content runs in an `<iframe sandbox="allow-scripts">` with `srcdoc`. Never add
    `allow-same-origin`: with it, the frame could reach ArcNave's cookies and API.
  - A CSP meta tag first in the document:
    - `default-src 'none'`;
    - `script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`;
    - `style-src 'unsafe-inline'`;
    - `img-src data: blob:`;
    - `font-src data:`;
    - `connect-src 'none'`;
    - `form-action 'none'`;
    - `base-uri 'none'`.
  - No `allow-popups`, `allow-forms`, `allow-top-navigation` or `allow-modals`.
  - Messages from the frame are accepted only when `event.source === iframe.contentWindow`, and
    only two types: `arcnave:resize { height }` (clamped) and `arcnave:prompt { text }` (≤ 500
    characters). A prompt is placed in the composer for the user to send, not sent by itself.
    The ADR records this as a deliberate difference from Claude.
  - The HTML is at most 200 kB, checked in the backend tool validation.
  - Record for later: serving from a separate origin, as Claude does, is stronger. It is out of
    scope here and noted in the ADR.
- **Steps:**
  1. `render_ui` gets a block type `visual { title, html }`. The tool description says when to
     use it (a diagram, chart or small interactive explanation that text cannot show), not a
     rule in the static prompt.
  2. `VisualBlock.tsx` with the sandbox above. Toolbar: full screen, download `.html`, download
     `.svg` (when the root element is an `svg`), copy as image (render the SVG to a canvas; for
     non-SVG, hide the button), save as artifact (`POST /artifacts` kind `webpage`).
  3. Webpage artifacts use the same sandbox component, so scripts run under the same rules.
  4. Add artifact kind `svg`: migration updating `ck_artifact_kind`, the `create_artifact` enum,
     the frontend type, and a preview that renders the SVG inside the same sandbox, never
     inline in the page.
- **Tests (security first):**
  - A frame script cannot read `document.cookie` of the parent: the component never sets
    `allow-same-origin` (assert the attribute).
  - The CSP is the first element of `srcdoc`.
  - Messages from another source, of another type, or over the size limits are ignored.
  - HTML over 200 kB is rejected by the tool with a typed error.
- **Acceptance (browser):**
  - "Show how compound interest grows, with a slider for the rate" gives an inline visual whose
    slider works.
  - A visual that tries `fetch('https://example.com')` is blocked (console shows the CSP error).
  - Save as artifact works, and the saved artifact still runs.
  - An SVG artifact renders.

## WP-11 — Word, Excel and PowerPoint previews

- Gap: 13. Branch: `feat/wp-11-office-preview`. Depends on: none.
- **Claude:** created and uploaded Office files can be looked at before downloading.
- **Current state:** the file panel in `Panels.tsx` previews images and PDFs. For other files it
  shows the extracted text. Download cards for created files go through `Content.tsx`.
- **Steps:**
  1. Word: render in the browser with `docx-preview` into a container. Its styles must not leak
     into the page.
  2. Excel: a backend route `GET /files/{id}/preview` (and the same for an artifact version)
     that reuses the backend's existing workbook reader. It returns every sheet's name and its
     first 200 rows × 50 columns as typed cells. The frontend shows sheet tabs and a table.
     Avoid the npm `xlsx` package: its registry version is old and has published advisories.
  3. PowerPoint: first check whether the sandbox image (`backend/sandbox/`) has LibreOffice. If
     it does, convert to PDF there and reuse the PDF preview. If not, show the slide outline from
     `inspectPptxStructure` and say that a visual preview is not available.
  4. The preview opens from both attachments and created-file download cards.
- **Tests:** the preview route returns typed cells and truncation flags; the frontend sheet
  table renders tabs.
- **Acceptance (browser):** upload a `.docx`, `.xlsx` and `.pptx`, and create an Excel file in
  chat; each opens in the panel.

## WP-12 — Public share links for chats and artifacts

- Gaps: 11, 16. Branch: `feat/wp-12-share-links`. Depends on: none. **ADR required**
  (privacy, unauthenticated route).
- **Claude:** a chat can be shared by public link and unshared; artifacts can be shared.
- **Current state:** `ShareButton` in `App.tsx` only copies an export. There is no
  unauthenticated read route.
- **Steps:**
  1. Table `share_links` with these columns:
     - `id`, `user_id`;
     - `token`: 32 random bytes, base64url, unique;
     - `target_type`: `chat` or `artifact`;
     - `target_id`;
     - `snapshot_seq`: the last message seq when shared, because a link shows a snapshot;
     - `created_at`, `revoked_at`.
  2. Owner routes: `POST /chats/{id}/share`, `POST /artifacts/{id}/share`, `GET /share-links`,
     `DELETE /share-links/{id}`.
  3. Public route `GET /public/share/{token}` needs no auth and is rate limited. It returns
     only message text and rendered answers up to `snapshot_seq`, and the artifact's current
     version. It never returns attachments, tool inputs or outputs, file contents, memory or
     usage. A revoked or unknown token returns 404 `share_not_found`.
  4. Frontend page `/s/:token`: read-only, `noindex`, with a banner that it is a shared snapshot.
  5. Incognito chats (WP-08) cannot be shared: 400 `share_not_allowed`.
- **Tests:** the public payload has none of the excluded fields (assert keys); a revoked token
  gives 404; rate limit; the token is not derivable from ids.
- **Acceptance (browser):** share a chat, open the link in a private window, revoke it, reload,
  and the link is gone.

## WP-13 — Memory import/export, data export, account deletion

- Gaps: 21, 22. Branch: `feat/wp-13-data-controls`. Depends on: none. **ADR required**
  (deletion scope).
- **Claude:** memory can be imported and exported; the account's data can be exported; the
  account can be deleted.
- **Current state:** `/memory` supports list, create, edit and delete; `/usage/export` exists.
  There is no full export and no account deletion. `/auth/password` exists.
- **Steps:**
  1. `GET /memory/export` returns JSON `{ version: 1, items: [...] }`. `POST /memory/import`
     takes that JSON or plain text (one memory per line, for text pasted from another
     assistant), skips duplicates, and reports added and skipped counts.
  2. `POST /account/export` builds a zip in storage and returns a download link that expires
     after 24 hours. The zip holds chats and messages (JSON), artifacts (Markdown and binary
     versions), memory, preferences, and the project file list.
  3. `DELETE /account` requires the current password. It deletes the database rows (most
     cascade from `users`; the ADR lists every table) and the stored objects: attachments,
     artifact binaries, project files and sandbox checkpoints. Then it ends all sessions.
  4. Settings > Data & privacy: buttons for each, with a typed confirmation for delete.
- **Tests:** export and import round-trip; a wrong password gives 403 with its code; after
  deletion no row with the user id remains in any table (loop over the schema's tables) and the
  fake storage has no object under the user's prefix.
- **Acceptance (browser):** export, delete a test account, and log in again, which fails.

## WP-14 — Connectors (remote MCP)

- Gap: 25. Branch: `feat/wp-14-connectors`. Depends on: none. **ADR required**. Split into
  sub-WPs after the ADR; do not implement in one conversation.
- **Claude:** remote MCP connectors (for example Drive, Slack, Asana) that the model can call,
  with per-tool permission.
- **Scope for the ADR:**
  - Remote MCP servers over Streamable HTTP with OAuth.
  - A per-user `connectors` table. Tokens are encrypted at rest with Cloud KMS; they are user
    data, never repository secrets.
  - Connector tools are namespaced (`<connector>__<tool>`), shown in the tool list only for that
    user, and go through the existing permission split.
  - Tool results are untrusted content, the same as web pages.
  - The sub-WPs are:
    - a: the MCP client and one test server;
    - b: the OAuth flow;
    - c: the settings UI;
    - d: permissions and the UI for tool calls.

## WP-15 — Skills settings

- Gap: 26. Branch: `feat/wp-15-skills-settings`. Depends on: none. **ADR required**.
- **Claude:** browse skills, turn them on or off, and upload custom ones.
- **Current state:** built-in skills in `backend/skills/*/SKILL.md`, loaded by
  `backend/src/services/skills.ts`; `GET /skills` and `GET /skills/{name}` exist; the UI shows
  skills only as tool activity.
- **Steps (after the ADR):**
  1. Settings > Skills lists skills with their descriptions and an on/off switch
     (`preferences.disabledSkills`). A disabled skill is left out of `<available_skills>`.
  2. Upload a custom skill as a `SKILL.md` or a zip. It is validated by the same frontmatter
     loader: `skills.test.ts` "none is dropped by its own frontmatter" must hold for it. It is
     stored per user, and its scripts run only in the sandbox.
- **Tests:** a disabled skill is absent from the prompt; an invalid upload returns a typed error
  naming the frontmatter field.

## WP-16 — Docs, Slides and Design types

- Gap: 10. **ADR required**; do after WP-10. Claude now has typed artifacts: living documents,
  decks and designs. ArcNave has document artifacts and `.pptx` export.
- The ADR decides:
  - a `slides` kind: Markdown with slide breaks, rendered as a deck and exported with the
    existing pptx path;
  - whether the document editor needs collaboration.

  Design (canvas) is out of scope until the rest ships.

## WP-17 — Save to Google Drive

- Gap: 12. **ADR required**. Needs a Google OAuth client, which the user creates in GCP; the
  agent never creates or stores its secret. Use the `drive.file` scope only. Add "Save to Drive"
  on download cards; the backend uploads the bytes with the user's token.

## WP-18 — Voice

- Gap: 27. **ADR required**.
- **Phase 1:** dictation with the browser's Web Speech API, with language `ta-IN` or `en-IN`
  chosen by the user. Text goes into the composer. The mic button is hidden where the API is
  unsupported.
- **Phase 2:** full voice mode via Vertex speech, in a later ADR.

## WP-19 — Break reminders, quiet hours, monthly recap

- Gaps: 23, 24. Branch: `feat/wp-19-reflect`. Depends on: WP-08 (recap excludes incognito).
- Preferences:
  - `breakReminderMinutes`: null, 30, 60 or 90;
  - `quietHoursStart` and `quietHoursEnd`, in the user's timezone.
- **Break reminder:** a gentle banner after that much continuous activity, dismissible.
- **Quiet hours:** a banner when the app is opened during them.
- **Recap:** `GET /recap?month=YYYY-MM` aggregates chat and message counts, busiest days, top
  projects and usage from `usage_records`, and excludes incognito chats. Settings > Reflect shows
  it.
- **Tests:**
  - the recap excludes incognito and deleted chats;
  - timezone boundaries at the start and end of the month.

---

## Kick-off prompt for each WP (paste into Antigravity, Planning mode)

```
Implement WP-XX from docs/handover/2026-09-26-claude-ui-parity-plan.md.

Follow AGENTS.md and the "How every work package is done" section of the plan. Work only on
WP-XX, on its branch, from the latest main.

First, read the files the WP names and confirm its "Current state". Then give me the
implementation plan and task list (and the ADR, if the WP says ADR required) for review
before writing code.

After I approve, implement it, write the listed tests, and run the backend and frontend
checks until they are clean. Then start the app locally and test every acceptance check in
the browser, with screenshots in the walkthrough. Do not deploy.
```
