# ADR-0033: Styles (presets and custom)

- Status: proposed
- Date: 2026-09-26
- Gap: 18 (Claude UI parity handover, Phase 2, WP-05)

## Context

Claude provides a "Use style" picker allowing users to select response styles:
- 4 built-in presets: Normal, Concise, Explanatory, Formal.
- Custom styles created either from explicit prompt instructions or synthesized from 1–3 writing samples.

A style modifies *how* the assistant formats, structures, and expresses its output (tone, brevity, explanatory depth), not *what* it knows or its factual truthfulness.

In ArcNave, the prompt architecture (`backend/src/services/promptCache/promptAssembly.ts`) strictly divides system prompt construction into:
1. `stablePrefix`: a 100% stable, deterministic block (`STATIC_BASE_SYSTEM_PROMPT_V1`, tool schemas, and static policies) cached across requests.
2. `dynamicSuffix`: per-turn dynamic runtime context (`currentDate`, `runtimeCapabilities`, `standingPreferences`, `projectInstructions`, `memory`, `compaction`, etc.).

### Cache Impact
If styles were embedded in the static base prompt or stable prefix, each style switch would yield a different prefix hash, invalidating the provider prompt prefix cache (e.g. Anthropic prompt caching or Vertex cached tokens) and causing cache misses for subsequent requests.

Placing style instructions in the dynamic suffix ensures that the stable prefix remains byte-for-byte identical regardless of which style is active.

## Decision

1. **Prompt placement & cache boundary invariant:**
   - The active style instructions are rendered in the dynamic suffix inside `<style_instructions>\n...\n</style_instructions>`.
   - Placed after `<standing_preferences>` and `<project_instructions>`, and before `<memory>`.
   - The stable prefix (`buildStablePrefix`) remains 100% byte-identical whether a style is applied or not.
   - Non-overridable boundary: A style instruction governs formatting and exposition only. A style *never* overrides truthfulness, safety boundaries, permissions, tool policies, or file creation rules.

2. **Style Presets (`backend/src/services/styles.ts`):**
   - Four presets with ArcNave's own distinct wording (never Anthropic's proprietary prompt text):
     - `normal`: Default ArcNave behaviour. Emits no style instruction block (`""`), preserving default concise-yet-thorough communication.
     - `concise`: Direct, compact, substance-first responses omitting unnecessary filler, historical preamble, and excessive exposition.
     - `explanatory`: Structured pedagogical explanations with contextual rationale, concept breakdowns, and clear step-by-step guidance.
     - `formal`: Executive, polished, and professional tone with structured syntax, neutral objective language, and rigorous organization.

3. **Custom Styles Database Schema:**
   - Table `styles` in `backend/src/db/schema.ts`:
     - `id`: UUID primary key, `defaultRandom()`.
     - `userId`: UUID, foreign key referencing `users.id` with `onDelete: 'cascade'`.
     - `name`: `varchar(60)`, not null.
     - `instructions`: `text`, not null (maximum 4,000 characters).
     - `version`: `integer`, not null, default 1 (optimistic concurrency).
     - `createdAt`, `updatedAt`: standard timestamptz.
     - Index on `(userId)`.
     - Constraint: instructions length <= 4000 (`ck_style_instructions_length`).
   - Column `style_id` in `preferences`: `varchar(64)`, default `'normal'`, tracks the user's active/last-used style.

4. **API Endpoints (`backend/src/routes/styles.ts`):**
   - `GET /styles`: Returns `{ presets: StylePresetDto[], items: StyleDto[] }` for the current user.
   - `POST /styles`: Creates a custom style `{ name: string (<= 60), instructions: string (<= 4000) }` -> 201 `StyleDto`.
   - `GET /styles/:id`: Returns a specific style (or preset details) by ID.
   - `PATCH /styles/:id`: Updates a custom style `{ name?, instructions?, version? }` -> 200 `StyleDto`.
   - `DELETE /styles/:id`: Deletes a custom style by ID -> 204.
   - `POST /styles/summarize`: Accepts `{ samples: string[] }` (1 to 3 writing samples) and runs a single model call with an injectable provider (faked in tests) to distill writing style into instructions <= 4,000 characters.
   - Typed error codes in `ERROR_CATALOG`:
     - `style_not_found` (404): "That style does not exist, or you do not have access to it."
     - `style_too_long` (422): "Style instructions cannot exceed 4000 characters."

5. **Generation Integration:**
   - `POST /chats/:id/generate` accepts an optional `styleId` in its request body (`z.string().max(64).optional()`).
   - Resolution order: explicit request `styleId` ?? stored `preferences.styleId` ?? `'normal'`.
   - When a valid `styleId` is provided in the request, `preferences.styleId` is updated to remember the choice.
   - If an unknown or unowned `styleId` is passed, generation aborts with `ApiError('style_not_found')`.

6. **Frontend Experience:**
   - Composer toolbar includes a "Use style" dropdown button alongside the conversation mode and model selection menus.
   - Dropdown displays preset options, user custom styles, and a "Create & edit styles" launcher.
   - Styles modal dialog allows managing styles: creating, editing, deleting, and pasting 1–3 writing samples to generate style instructions with user confirmation.
