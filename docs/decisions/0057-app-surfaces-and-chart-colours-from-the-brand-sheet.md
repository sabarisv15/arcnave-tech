# ADR-0057: Projects, library, artifact panel and charts take the brand sheet's colours

- Status: accepted. Tested locally (Chromium against a mocked `/v1`, 1440 and 390 px, light and dark); not live.
- Date: 2026-10-14
- Builds on: [ADR-0036](0036-sandboxed-visuals-inherit-arcnave-theme.md) (sandboxed visuals inherit the
  ArcNave theme). Its mechanism is unchanged: tokens written into the frame document, every element rule
  inside `:where()`, theme changes sent by message. Only the token values change.
- Part of Phase 1 item G (brand), sub-item G4. Source: the owner's locked boards in
  `arcnave-frontend/docs/brand/` (`BS-Base`, `BS-Project`, `BS-Artifact`, `BS-PartsA`, `BS-PartsB`).

## Context

G0 to G2 put the brand tokens, the app shell and the sign-in page in place. The pages inside the sheet
(projects, project page, library, the artifact panel beside the chat, the share dialog) still wore the
old neutral grey styling, and the two places ArcNave draws charts (recharts display cards, sandboxed
visuals) still used their own hexes: a blue-grey set in `sandboxTheme.ts`, a twelve-colour list in
`DisplayCards.tsx` and a Tailwind-style list in `ChartBlock.tsx`.

How Claude does it: the reference for the *mechanism* is already recorded in ADR-0036 (the host hands an
embedded app its theme as CSS variables; the app uses them instead of hard-coded colours). The *look* is
ArcNave's own and comes from the owner's boards, not from Claude (Invariant 7: launch files do not
describe ArcNave as following another assistant).

## Decision

1. **Pages follow the boards.** New file `src/surfaces.css` (loaded after `shell.css`) plus
   `src/surfaces.tsx` carry the board classes (`pcard`, `side-card`, `lcard`, `apanel`, `atool`, `pbtn`,
   `gbtn2`, `ibt`, `seg2`, `fld`, `crow`, `frow`) as `sf-*`. Every value is a token from `brand/tokens.css`.
2. **A board item with no backend behind it is not drawn.** Left out: project sharing and member list
   (sharing exists for chats and artifacts only), the storage meter ("18% used"), the company-only share
   option ("People in <college>", the backend has public links only), the Sheets and Uploads library
   filters (there are no such kinds), the Report link on the shared page. Nothing is a dead button.
3. **Chart colours are the six brand tokens in the board's fixed order**, in both themes: Kulam green,
   Marigold, Sky, Terracotta, Jamun, Neem (`--chart-1..6`). `src/chartColors.ts` names them as
   `var(--chart-n)`, so a chart follows the theme without re-rendering; both recharts files use it.
   Marks follow BS-PartsB: bars with leaf tops (6 / 1.5 px), 2 px between bars, thin grid and axis
   (`--chart-grid`, `--chart-axis`), a raised hover card. Two or more series always get a legend.
4. **`sandboxTheme.ts` carries the brand palette.** `--text`, `--surface`, `--border`, `--accent`,
   `--good/bad/warn/info`, `--c1..c6` and the new `--grid` / `--axis` are brand tokens for light and dark;
   radius 12 / 16; headings 700, buttons 600, `.stat` 30/700, one-pixel hairlines. A test
   (`chartColors.test.ts`) reads `tokens.css` and fails if the two drift apart. The Chart.js bridge now
   uses `--grid` for grid lines and exposes `grid` and `axis` in `window.arcnave.colors()`.
5. **Sandboxed visuals keep the system font.** The frame's CSP allows fonts only as `data:` URLs
   (ADR-0036 consequence), so Onest is not available inside it. This is the one place the app's UI font
   does not reach; it is recorded here rather than worked around.
6. **The artifact panel opens at 480 px** (400 px for sources and files) until the person drags its edge.
   Its header row (versions, Preview / Edit, Download, Share) needs about 450 px, and BS-Artifact gives
   the artifact more room than the chat.

## Where we differ from the board, and why

- The board's header is one 60 px row. At panel widths of 320 to 600 px it cannot hold the title, version
  switch, view switch and actions, so it is two rows: title with expand and close, then the actions.
- The view switch says **Preview / Edit**, not Preview / Code: the second tab is an editor that saves a
  new version, not a read-only source view.
- A series colour a model passes explicitly (`series.color`) is still honoured. A chart with more than six
  series repeats the six in order; the board defines six and no seventh.

## Not done (known, for the owner)

- Display-card charts have no table view (chart blocks do). The board says every chart has one.
- `.ui-comparison-*`, `.ui-cards-*` and the rest of the generative-ui block CSS (`styles.css` from about line 4150) still refer to
  `--card`, `--border`, `--foreground` and `--muted-foreground`, which no stylesheet defines, so they
  fall back to their literal hexes and ignore dark mode. Charts were fixed here; the other blocks belong
  with the chat parts item (G3).
- `styles.css` keeps the old `.page`, `.project-*` and `.artifact-*` rules; the pages no longer use them.
  Removal waits until G3 has merged, so the two items do not edit the same file.
