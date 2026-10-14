# ArcNave – Stage 4 · L5.6 Speech Service – full audit
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01) · Labels: Vendor / Partial / ArcNave rec · Engine pick (M10) → Stage 9_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - **SPD-3 = mic max 2 min** (Stage 9 G50); longer recordings → upload as audio file.
> - **SPD-5 = Gemini 3.8 Flash for mic + audio files, provisional** (Stage 9); final after Stage 21 Tanglish/Tamil/Hindi eval; Chirp 3 not used; gemini-3.5-transcribe re-checked at GA.


## Contract
transcribe(audio, language_hint=en-IN, mode=short|long) → text (+ optional timestamps, speakers). Short = mic clip (sync, API service). Long = uploaded audio file (worker batch).

## Real-product evidence
- Claude apps: dictation (speech → text in message box, edit before send) vs voice mode (spoken two-way); web, iOS/Android, desktop.
- ChatGPT: dictation audio sent for transcription, text appears in composer for review; audio kept while chat exists, deleted within 30 days after chat delete; business data not used for training by default.
- Gemini API: 32 tokens/s audio (1 min = 1,920 tokens), up to 9.5 h/prompt, inline request ≤20 MB, multi-channel merged, timestamps, speakers, language detection, non-speech sounds.
- Google Chirp 3: US + EU multi-region only (no asia-south1/global yet); en-IN, hi-IN GA; ta-IN + 8 Indian languages preview; Recognize <1 min, Streaming, BatchRecognize 1 min–1 h; auto language detect, 1,000 phrase hints, denoise, diarization; no word confidence; $0.016/min (per-second rounding), dynamic batch $0.003/min. Code-switching not documented.

## Items
| # | Item | Source | Rec |
|---|---|---|---|
| SP1 | Gemini audio formats, 1 audio file per prompt, timestamps/speakers | Vendor (Google) | MVP |
| SP2 | Chirp 3 option (methods, languages) | Vendor (Google) | Stage 9 |
| SP3 | Mic clip → sync path; audio file → worker batch | ArcNave rec | MVP |
| SP4 | Claude has no audio input → transcript first | Vendor (Anthropic) | MVP |
| SP5 | App mic format must be supported (webm/m4a) | Vendor (Google) | MVP (L1) |
| SP6 | Dictation pattern: transcript into composer, user edits, then sends | Vendor (Claude, OpenAI) | MVP |
| SP7 | Voice mode (spoken replies, TTS) | Vendor (Claude, OpenAI) | Later |
| SP8 | Audio retention policy stated | Vendor (OpenAI) | MVP (SPD-2) |
| SP9 | Chirp 3 processes in US/EU only → location disclosure if chosen | Vendor (Google) | Stage 9 |
| SP10 | Indian languages + phrase hints (company terms) | Vendor (Google) | Stage 9 |
| SP11 | Tanglish/Hinglish code-mixed speech not documented → must test | Partial | MVP eval |
| SP12 | Gemini audio limits (20 MB inline, 1,920 tokens/min) | Vendor (Google) | MVP |
| SP13 | LLM transcription may rewrite/hallucinate, no word confidence → verbatim prompt + user sees transcript (SP6) | ArcNave rec | MVP |
| SP14 | Max mic length; longer → audio file path | ArcNave rec | MVP (SPD-3) |
| SP15 | Errors: no speech, noise, too long, bad format → clear message, no quota charge | ArcNave rec | MVP |
| SP16 | Cost per minute into cost meter (Chirp per-second; Gemini audio tokens – price verify) | Vendor | Stage 18 |
| SP17 | Latency target for mic → text (fast reply); streaming partial text later | ArcNave rec | MVP target / Later streaming |
| SP18 | Speech evals on Indian English + Tanglish samples before engine pick | ArcNave rec | MVP offline |
| SP19 | Mic transcript = user's own words (memory allowed); audio-file transcript = file content (untrusted, no memory) – matches M11 | ArcNave rec (consistency) | MVP |
| SP20 | Company admin mic ON/OFF | Vendor (OpenAI audio settings) | Later |

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CS1 | Claude API has no audio input → always our transcript as text | MVP |
| CS2 | Claude dictation/voice mode are app features, not API → we build our own | MVP fact |

## Decisions
| ID | Question | Rec |
|---|---|---|
| SPD-1 | Mic behaviour | Dictation (text into box, edit, send); voice mode later |
| SPD-2 | Mic audio retention | Delete audio after successful transcript; keep text only. Uploaded audio files follow file retention |
| SPD-3 | Max mic length | ~2 min; longer → upload as audio file. Final number Stage 9 |
| SPD-4 | Languages | Indian English + Tanglish/Hinglish must work; Tamil/Hindi best effort |
| SPD-5 | Engine | Gemini vs Chirp 3 → Stage 9 after eval (Chirp = US/EU processing) |
