# ADR-0042: Voice dictation with the browser's speech recognition

- Status: accepted (phase 1). Tested locally with a stubbed recogniser; not live.
- Date: 2026-09-27

## Context

Claude's apps take speech (Claude Help Center, read 2026-09-27):
- **Dictation** ("Use dictation on Claude Mobile"): tap the microphone at the right of the
  message box; the first time, choose a language. The words go into the message box to be
  sent.
- **Voice mode** ("Use voice mode"): a spoken conversation. Out of scope here.

ArcNave had no speech input. Its users write in English and Tamil.

## Decision

1. **Phase 1 is dictation only**, with the Web Speech API (`SpeechRecognition`, or
   `webkitSpeechRecognition`).
   - The mic button sits at the right of the composer, and is not shown where the browser has
     no recogniser.
   - The first use opens a language menu: English (India), Tamil, English (US) and Hindi,
     sent as `en-IN`, `ta-IN`, `en-US` and `hi-IN`. The choice is kept in this browser's
     storage; later uses start at once, and the language can be changed beside the mic.
2. **Text handling.** Dictated text is added after what is already typed, with one space. Words
   still being recognised show as they come and are replaced when final. Nothing is sent until
   the user sends it. Stopping is the same button; while listening it is marked and pulses,
   except under reduced motion.
3. **Errors say why:** microphone blocked, no microphone, no connection to the speech
   service, or a language this browser cannot recognise. "No speech" and a deliberate stop
   are not errors.
4. **Phase 2, full voice mode** (spoken replies, hands-free turns), needs a speech service on
   the backend. That is a later ADR.

## Consequences

- Recognition runs in the browser's own speech service (Google's in Chrome and Edge, Apple's
  in Safari), not in ArcNave. What the user says goes to that service under the browser's
  terms. ArcNave receives only the text the user sends.
- Firefox has no recogniser, so it shows no mic.
- The language list covers ArcNave's users now; more are a one-line addition.
