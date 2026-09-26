# ADR-0035: Model-written HTML runs only in a script-only sandbox

- Status: accepted. Tested locally; not live.
- Date: 2026-09-26
- Work package: WP-10 in `docs/handover/2026-09-26-claude-ui-parity-plan.md` (gaps 1, 8 and 9).

## Context

Claude's app draws custom visuals inline in an answer. They are HTML, so they can be
interactive (buttons, sliders, full screen). They can be downloaded as `.svg` or `.html`, copied
as an image, or saved as an artifact, and a click inside one can send a follow-up prompt (Help
Center, "Custom visuals in chat and Cowork", read 2026-09-26). Claude's artifacts can also be
small interactive tools.

ArcNave had neither:
- `render_ui` accepts fixed block types only, and rejects any string containing a script.
- The webpage artifact preview is `<iframe sandbox="">` with `default-src 'none'`, so no script
  runs.

Running model-written HTML and JavaScript inside ArcNave's page is the largest security risk in
the UI parity plan. The model may be steered by a web page or an uploaded file (prompt
injection), so its HTML is treated as untrusted code.

How Claude contains it (published write-ups, read 2026-09-26; Anthropic's own pages do not
describe it):
- Each artifact is served from its own origin, `<uuid>.frame.claudeusercontent.com`.
- It runs in an iframe sandbox with a strict CSP, and is expected to be self-contained, with no
  external network calls.

## Decision

1. **Sandbox.**
   - Model-written HTML is rendered only by one component, `SandboxFrame`
     (`arcnave-frontend/src/SandboxFrame.tsx`), as `<iframe sandbox="allow-scripts">` with
     `srcdoc`.
   - `allow-same-origin` is never set. Without it the frame has an opaque origin: it cannot read
     ArcNave's cookies, storage or DOM, and it cannot call the API with the user's session.
   - `allow-popups`, `allow-forms`, `allow-top-navigation`, `allow-modals` and every other token
     are left out. The frame cannot open windows, submit forms, show dialogs, or move the
     ArcNave tab.
2. **CSP.** The document starts with this policy as its first element, before any model content.
   It sits in a `<head>` that ArcNave writes. A second policy the content adds can only narrow
   it.

   ```
   default-src 'none';
   script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;
   style-src 'unsafe-inline';
   img-src data: blob:;
   font-src data:;
   connect-src 'none';
   form-action 'none';
   base-uri 'none'
   ```

   - `connect-src 'none'` blocks `fetch`, XHR and WebSocket.
   - `img-src data: blob:` blocks image beacons.
   - Scripts may load libraries only from the two public CDNs.
3. **Messages.**
   - The parent accepts a message only when `event.source` is that frame's `contentWindow`, and
     only these two types:
     - `arcnave:resize { height }`: the height is clamped to 80–2000 px;
     - `arcnave:prompt { text }`: at most 500 characters.
   - Everything else is ignored.
   - A small bridge script, written by ArcNave and placed before the content, exposes
     `window.arcnave.prompt(text)` and reports the document height.
4. **A prompt is not sent by itself.**
   - `arcnave:prompt` puts the text in the composer; the user presses Send.
   - Claude sends such follow-ups automatically. ArcNave does not, because a visual's script is
     untrusted code, and sending in the user's name without a click would let an injected page
     speak for the user. This is a deliberate difference from Claude.
5. **Navigation is reset.**
   - A link or script can still navigate the frame itself: sandboxing cannot stop this, and CSP
     `navigate-to` was never shipped.
   - `SandboxFrame` treats a second `load` event as a navigation. It restores the original
     document and says "Navigation blocked".
   - The request has already left by then. This is a residual risk, noted under Consequences.
6. **`render_ui` gets a `visual` block.**
   - The block is `{ title, html }`.
   - Allowed only at the top level: never inside a dashboard, and at most 2 per response.
   - The HTML is at most 200,000 UTF-8 bytes. Over that, the tool fails with the stable code
     `visual_too_large`.
   - The UI response's own byte cap (`UI_MAX_RESPONSE_BYTES`) no longer counts a visual's HTML,
     which has its own cap.
   - The tool result sent back to the model replaces each visual's `html` with `htmlBytes`.
     - The HTML is already in the model's own tool call, which history replays.
     - A second copy would add up to about 50,000 tokens to every later turn.
   - On reload, the client takes each visual's HTML from the call input, by the block's
     `sequence`.
7. **Artifacts.**
   - Webpage artifacts render in the same `SandboxFrame`, so their scripts run under the same
     rules.
   - A new kind, `svg`, is added:
     - migration 0016 widens `ck_artifact_kind`;
     - the `create_artifact` and `/artifacts` enums accept it;
     - its preview renders the SVG inside `SandboxFrame`, never inline in ArcNave's page.
   - A visual can be saved as an artifact: kind `svg` when its root element is `<svg>`,
     otherwise `webpage`.
8. **Visual toolbar.**
   - Full screen.
   - Download `.html`.
   - Download `.svg` and copy as image, shown only when the root element is `<svg>`. The image
     is drawn to a canvas in ArcNave's page from the SVG text, never from the frame.
   - Save as artifact.
9. **Prompt.** The `render_ui` description and the Generative UI policy say when a visual is
   the right form: a diagram, chart or small interactive explanation that text and the fixed
   blocks cannot show. They also say what the sandbox allows. The static base prompt is
   unchanged.

## Not done, recorded for later

- **A separate origin per frame**, as Claude uses (`*.frame.claudeusercontent.com`).
  - It would add process isolation on top of the opaque origin.
  - It needs a second domain and a serving route.
  - It is the next step if visuals ever need `allow-same-origin` (for example localStorage).
- **Google Fonts or other hosts** are not allowed; fonts must be `data:` URIs.

## Consequences

- **Residual risk: frame navigation.** A visual can navigate its own frame, for example to
  `https://x.example/?q=<data>`, and send whatever the frame holds. The frame holds only the
  model's HTML and what the user typed into that visual. The navigation is reset at once.
  Claude's frames have the same exposure.
- **Residual risk: CDN scripts.** Scripts from cdnjs and jsdelivr run inside the same sandbox
  and CSP, so they reach nothing the visual itself cannot.
- **Tests** (`SandboxFrame.test.tsx`, `validator.test.ts`, `uiExecutor.test.ts`):
  - the frame never has `allow-same-origin` or any token but `allow-scripts`;
  - the CSP is the first element of `srcdoc`;
  - messages from another source, of another type, or over the limits are ignored;
  - a second load restores the document;
  - HTML over 200,000 bytes fails with `visual_too_large`;
  - the result to the model has no `html`.
