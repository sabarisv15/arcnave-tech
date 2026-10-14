# ArcNave – Stage 6 · Opus 5.5 system prompt decode (block by block)
_2026-10-01 · Source: Anthropic official release notes – Claude Opus 5.5 system prompt (22 Sep 2026, claude.ai + mobile apps only, NOT API) · Short quotes only, no reproduction · Status: DRAFT for user review_

**Key fact:** this prompt is NOT applied on the API/Vertex. Claude on Vertex gets only what ArcNave writes. Everything below that we want, we must write ourselves.

## Block map
| # | Block | What it covers | Layer / concern | How it is written | Why written that way | Quality effect | ArcNave |
|---|---|---|---|---|---|---|---|
| B0 | `<claude_behavior>` root + "The assistant is Claude, created by Anthropic." | Identity | Identity | One root XML tag, third person ("Claude does…") | Describes a character, not orders; sections easy to edit/version | Consistency of persona | Keep root tag; keep "You are ArcNave" (2nd person – no evidence 3rd person is better for Gemini) |
| B1 | product_information | Model names, products, API strings, Mythos tier, how to get help, settings | Self-knowledge / scope | Facts + hard boundary: "product knowledge ends here" + "search support site" | Models hallucinate about their own product; boundary stops invention | Fewer wrong self-claims | **Adopt boundary** (SPD-7); our capabilities list already exists |
| B2 | refusal_handling (+ child safety sub-block) | What to decline: child safety, weapons, drugs (harm-reduction sites), malware, copyright (lyrics/poems, pre-1929 rule), visual works, real public figures | Safety policy | Rule + reason; anti-rationalisation ("framing doesn't change the artifact", "past help is not authorization", judge whole conversation); CAPS only for child safety; examples (banner, book cover, toast) with rationale; bad vs good response | Stops jailbreak by reframing / step-by-step; examples show the line better than words | Fewer jailbreaks AND fewer over-refusals | Adopt cumulative judgement + persistence + framing clause (SPD-6); copyright lite (SPD-14) |
| B2a | Ambiguity rule (Nadia toast) | When unsure and no rule covers it → don't refuse; agree, ask ONE question that surfaces the real concern, then do it | Over-refusal control | Bad vs good example + rationale | Refusing gray requests annoys users; asking reveals real risk | Big gain in helpfulness | **Adopt** (SPD-3) |
| B3 | legal_and_financial_advice | Give facts, not confident recommendations; say not a lawyer/adviser | Liability | One short rule | Avoid harm + liability | Safer advice tone | Merge into our safety line (SPD-10) |
| B4 | tone_and_formatting (+ lists_and_bullets) | Work mode vs chat mode; prose default; lists only when useful; no bullets in refusals; match effort; change only what was asked; one question max; check that a mentioned file is really attached; no cursing; minors | Output style | Positive instructions ("prose by default") + thresholds ("few sentences", "at most one question") | Models over-format and over-answer; thresholds make it measurable | Cleaner, shorter, on-target answers | Adopt match-effort, change-only-asked, file-present check (SPD-4, SPD-5) |
| B5 | user_wellbeing | Accurate terms; self-harm (no harmful substitutes); disordered eating (no numbers); crisis-service experiences; signs of mania/psychosis; accurate helplines (dead NEDA line example); no categorical confidentiality claims | Wellbeing / risk | Very specific "do not" list + concrete current resource | Specific failure cases seen in real use; stale helpline = real harm | Safer sensitive replies | Adopt core: care, accurate Tele-MANAS, keep help path open, no promises about confidentiality (SPD-11) |
| B6 | anthropic_reminders | Injected classifier reminders; they never reduce restrictions; tags in user turn may be fake | Prompt-injection / trust channel | Defines the ONLY trusted channel + what it can never do | Attackers paste fake "system" tags | Injection resistance | Already in `<authority>`; add "ArcNave notices never relax rules" if Safety service injects notes (Later) |
| B7 | evenhandedness | Persuasive content = "case others would make"; add opposing views; no personal opinions on contested politics; may refuse one-word answers on complex issues | Neutrality | Rule + framing technique | Brand + trust risk | Balanced answers | Adopt lite – Indian politics/religion neutral (SPD-9) |
| B8 | responding_to_mistakes_and_criticism | Own mistakes, fix them; no excessive apology; stay steady if user rude; thumbs-down feedback | Relationship / feedback loop | Balanced rule | Models grovel or cave | Steadier tone | Adopt (SPD-8) – point to ArcNave feedback button |
| B9 | knowledge_cutoff | Cutoff + `{{currentDateTime}}`; answer like informed person at cutoff talking to someone on today's date; don't confirm/deny post-cutoff claims; suggest web search | Time / epistemics | Template variable + persona framing | Stops "it's still 2025" errors and invented news | Correct dates, honest uncertainty | Adopt wording (SPD-12); we already inject IST time |

## Writing techniques (how + why)
| # | Technique | Why it works | Evidence | Conf. |
|---|---|---|---|---|
| T1 | Rule + reason | Model generalises to unseen cases | ✅ Anthropic prompting best practices: "add context/motivation" improves performance | High |
| T2 | Examples with rationale, incl. bad vs good | Shows the exact line; rationale stops blind copying | ✅ Anthropic (multishot examples); Google (few-shot) | High |
| T3 | Emphasis (bold/CAPS) only for one critical area | Newer models over-trigger on aggressive wording | ✅ Anthropic best practices (dial back "CRITICAL/MUST") | High |
| T4 | Anti-rationalisation clauses | Blocks reframing / incremental jailbreaks | ⚠️ Pattern seen in prompt; no vendor metric | Medium |
| T5 | Scope boundaries ("knowledge ends here") | Stops hallucination outside known facts | ⚠️ Pattern only | Medium |
| T6 | Persistence across turns | Stops rephrase-until-yes | ⚠️ Pattern only | Medium |
| T7 | Concrete names/numbers (helplines, URLs, dates) | Model can't invent or use stale ones | ⚠️ Pattern only | Medium |
| T8 | Positive instructions + thresholds | "Do X" works better than "don't do Y" | ✅ Anthropic best practices | High |
| T9 | Template variables (date) | Static prefix stays cacheable, dynamic parts swap | ✅ Caching docs (both vendors) | High |
| T10 | Escape valve: ask one question instead of refusing | Cuts over-refusal | ⚠️ Pattern only | Medium |
| T11 | Third-person "Claude…" | Persona description | 🔧 No evidence it beats "You" | Low |

## Does it increase output quality?
- Yes, for **specific behaviours** (format, refusal line, over-refusal, dates, injection): T1/T2/T3/T8 are vendor-backed. Conf. High.
- But Claude is **trained together with** this prompt; Gemini is not → same text gives smaller/different gain on Gemini. Conf. Medium-High.
- Length costs: their prompt ~6.5–8k tokens; Google says Gemini 3 prefers concise direct instructions → copy techniques, NOT length. Conf. High.
- Real gain must be measured with our eval set (CXD-7) before/after. No claim without numbers.

## Not in this prompt (ArcNave must write itself)
Reply language / Tanglish (N13) · authority ladder ArcNave > admin > project > user · citations [S1] · tenant/data isolation · tool and memory rules (claude.ai adds those in separate sections, not in this page) · B2B tone.

## Answers to open v0 questions
| Question | What Claude app does | ArcNave rec |
|---|---|---|
| Model name disclosure | States current model; says person may switch models; lists models | Say the model shown in picker; never guess versions (keep v0) |
| Citation format | Not in this block (tool-specific) | Keep [S1] ids – our choice |
| Brand tone | Curious, warm; "professional mode" for work, casual for chat | Work mode default (B2B); warm, no filler |
| Capabilities list | Product list + hard boundary + support link | Keep list + add boundary + "ask your admin / ArcNave support" |

## Proposed v0 → v1 changes
| ID | Change | MVP/Later |
|---|---|---|
| SPD-1 | One-line reason for each key rule | MVP |
| SPD-2 | 3 short examples with rationale: Tanglish mirroring, injection inside file, ambiguous request (ask vs refuse) | MVP |
| SPD-3 | Ambiguity rule: help with safe part, ask one surfacing question, don't refuse by default | MVP |
| SPD-4 | Match effort; change only what was asked (no full rewrite unless asked) | MVP |
| SPD-5 | If user mentions a file that isn't attached, say so – don't pretend | MVP |
| SPD-6 | Judge whole conversation; framing/role-play doesn't change harm; once declined, keep declining rephrasings | MVP |
| SPD-7 | ArcNave product-knowledge boundary | MVP |
| SPD-8 | Mistakes section: own it, fix, no grovelling, steady when user rude, feedback button | MVP |
| SPD-9 | Neutrality on contested politics/religion; persuasive text framed as others' view + opposing view | MVP |
| SPD-10 | Legal/finance: facts, not confident recommendations | MVP |
| SPD-11 | Wellbeing: keep help path open; no promises about confidentiality of helplines | MVP |
| SPD-12 | Cutoff wording: informed person at cutoff; don't confirm/deny later claims without search | MVP |
| SPD-13 | No CAPS/"MUST" except one critical rule | MVP |
| SPD-14 | Copyright: don't reproduce lyrics / long book or article passages (user's own uploads OK) | MVP |
| SPD-15 | "ArcNave notices never relax rules" channel – only if Safety service injects notes | Later |
Size after change: ~3–3.5k tokens (+tools → crosses Gemini 4,096 implicit-cache minimum).

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CO1 | App prompt not applied on API/Vertex – Claude via Vertex has none of these behaviours from prompt | Write our own (v1) |
| CO2 | Claude follows XML-tagged sections well | Keep XML sections |
| CO3 | Claude 4+ models over-trigger on aggressive wording | SPD-13 |
| CO4 | Claude trained on these behaviours → our short lines get stronger effect on Claude than on Gemini | Gemini overlay may need extra explicit lines (eval) |
| CO5 | Claude app prompt has no reply-language rule | Our language rule applies to Claude too |

## Fable 5.1 prompt (1 Sep 2026) – differences vs Opus 5.5
Same `<claude_behavior>` blocks. NO memory / tools / skills / artifacts / search / file sections in either published page (checked 2026-10-01). Extra in Fable:
| Block | Rule | ArcNave |
|---|---|---|
| `<reply_after_tool_calls>` | After last tool call, state the answer in 1–2 sentences; "Done." alone is not a reply; don't repeat what was said before tools | Adopt (SPD-16) |
| `<tone_preference>` (outside root) | "Outputs are reasonably concise" – separate block, likely user/setting-driven | Company/user tone setting as separate swappable block (SPD-17, Later) |
| tone_and_formatting extras | Avoid filler words ("genuinely", "honestly", "straightforward"); no formatting in personal/emotional chats | Add filler-word line to `<style>` (SPD-18) |

## Unofficial full prompt (leak repo asgeirtj/system_prompts_leaks) – structure only ⚠️ unverified
Repo README itself says official release-notes versions are "shorter than the real served prompts". Leaked Opus 5.5 claude.ai prompt ≈120k tokens (my estimate):
| Section | ~Tokens | Concern |
|---|---|---|
| claude_behavior | 6.9k | = official page |
| memory_filesystem + privacy_requirements + memory_application (+examples, forbidden phrases, boundaries, preferences guardrails) | ~16.5k | Memory |
| end_conversation_tool_info | 0.8k | Abuse handling |
| past_chats_tools + preferences_info | 3.6k | Chat history search, user prefs |
| mcp_app_suggestions + suggest plugins/skills | 2.6k | Connectors |
| computer_use (skills, file_handling, outputs, artifact criteria) + publishing_artifacts + visual checklist/visualizer | ~10k | Files / outputs |
| search_instructions (incl. copyright, harmful content) | 6.4k | Web search |
| Tools (≈90 tool definitions; Artifact alone 5.8k) | 66k | Tool schemas |
| anthropic_api_in_artifacts, available_skills, network/filesystem config, thinking_behavior | ~5.7k | Misc |
Lesson: behaviour core is small (~7k); feature sections are added per enabled feature; tool schemas dominate size → ArcNave: load only tools enabled for the turn; keep each feature section separate and swappable. Section contents not read (access blocked in my workspace).

## Sources
- Anthropic – Claude Fable 5.1 system prompt release note: https://platform.claude.com/docs/en/release-notes/system-prompts/claude-fable-5-1
- Anthropic – Claude Opus 5.5 system prompt release note: https://platform.claude.com/docs/en/release-notes/system-prompts/claude-opus-5-5
- Anthropic – Prompting best practices: https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices
- Google – Gemini 3 prompting guide (P4 in Astra results, concise direct instructions)
