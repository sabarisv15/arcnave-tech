# ADR-0043: Contextual follow-ups, reply style and safe answer rendering

- Status: accepted by the user's 2026-09-27 instructions to implement and integrate these fixes.
- Amends ADR-0032 (reply language), ADR-0022 (initial tools), and ADR-0035 (visual persistence).
- Base: latest main `94deb57`. Retains ADR-0035/0036/0037 sandbox, theme and visual draft design.
- Amended by [ADR-0046](0046-tools-and-skills-cut-to-the-reference.md): the `suggest_next_actions` tool and follow-up chips are removed.

## Decision

Match the current user's language, script and conversational style. Latin Tanglish stays
Latin Tanglish, English stays English, Tamil script can receive Tamil script. Explicit
translation requests override inference; short ambiguous turns use conversation context.
Apply the same guidance to progress and next-action proposals. Real model acceptance is
distinct from checking the assembled prompt with fake providers.

Use optional `suggest_next_actions` proposals in the existing turn, with up to three short
contextual actions and a separate composer hint. Do not issue a second provider request or
invent suggestions from keywords/source domains. Only successful tool proposals provide a
hint, and pending/new turns have none. Known obsolete generic questions are hidden without
rewriting persisted messages. Keep `ask_user_options` and its existing turn-ending behavior.

Support single-dollar inline LaTeX in the shared Markdown plugins, retaining currency/code
regressions and the upstream CodeBlock/Mermaid components. Bound answer width by the
composer's 760px maximum. Use the existing Lucide family for the sidebar refresh.

Label non-native tool history as historical execution data and reject textual tool protocol
outside code with stable `tool_protocol_in_text` before streaming/persisting its payload.
Preserve native provider signatures and execution evidence. The supplied export demonstrates
leaked protocol, but its original production provider/deployed revision was not inspected;
history replay is a plausible cause, not a confirmed root cause for that production turn.

Persist confirmed visual block IDs in response segments. Hydrate all successful validated
results, recovering their checked HTML with the existing `withVisualHtml` mechanism.
Do not hydrate failed/unexecuted raw input. Retain upstream SandboxFrame, streamed visual
drafts, artifact ownership checks, SVG/slides kinds and migrations. No second sandbox or
duplicate SVG migration is introduced by this integration.

## Integration and release

Local pre-sync work is preserved in named stash `chat-fixes-before-main-sync-2026-09-27`.
The earlier independent visual implementation is superseded by the newer upstream work.
Current fixes are re-applied onto latest main; all upstream functionality is retained.
No new dependencies are added. OpenAPI is regenerated for the UI segment response shape.
Merge to main triggers the configured Cloud Build deployment and therefore requires explicit
current-task deployment approval after the concrete PR is ready.
