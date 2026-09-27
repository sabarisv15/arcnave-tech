/**
 * Dictation into the composer (WP-18, ADR-0042), with the browser's speech recognition. As in
 * the first use asks for the language; after that the mic starts at once.
 * Where the browser has no recognition, there is no mic button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { readLocal, writeLocal } from "./storage";
import { Dropdown } from "./ui";

export const DICTATION_LANGUAGES = [
  { code: "en-IN", label: "English (India)" },
  { code: "ta-IN", label: "தமிழ் (Tamil)" },
  { code: "en-US", label: "English (US)" },
  { code: "hi-IN", label: "हिन्दी (Hindi)" },
] as const;

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const dictationSupported = () => recognitionClass() !== null;

/** Joins spoken text onto what is typed, with one space between. */
export function joinDictated(typed: string, spoken: string): string {
  const s = spoken.trim();
  if (!s) return typed;
  if (!typed) return s;
  return /\s$/.test(typed) ? typed + s : `${typed} ${s}`;
}

const MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it for this site in the browser, then try again.",
  "service-not-allowed": "This browser does not allow speech recognition here.",
  "audio-capture": "No microphone was found.",
  network: "Dictation needs a connection to the browser's speech service.",
  "language-not-supported": "This browser cannot recognise that language. Choose another one.",
};

export function DictationButton({
  text,
  setText,
  onError,
  disabled,
}: {
  text: string;
  setText: (value: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const Impl = recognitionClass();
  const [language, setLanguage] = useState<string | null>(() => readLocal("dictation-language"));
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  // The text as it was when listening began, and what has been said and settled since.
  const base = useRef("");
  const settled = useRef("");
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => () => recognition.current?.abort(), []);

  const start = useCallback(
    (lang: string) => {
      if (!Impl) return;
      const r = new Impl();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      base.current = textRef.current;
      settled.current = "";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]!;
          if (result.isFinal) settled.current = joinDictated(settled.current, result[0].transcript);
          else interim = joinDictated(interim, result[0].transcript);
        }
        setText(joinDictated(base.current, joinDictated(settled.current, interim)));
      };
      r.onerror = (e) => {
        if (e.error !== "aborted" && e.error !== "no-speech") onError(MESSAGES[e.error] ?? "Dictation stopped.");
      };
      r.onend = () => {
        setListening(false);
        recognition.current = null;
      };
      recognition.current = r;
      try {
        r.start();
        setListening(true);
      } catch {
        onError("Dictation could not start.");
      }
    },
    [Impl, onError, setText],
  );

  if (!Impl) return null;

  const choose = (code: string) => {
    writeLocal("dictation-language", code);
    setLanguage(code);
    start(code);
  };
  const languageLabel = DICTATION_LANGUAGES.find((l) => l.code === language)?.label;

  if (listening)
    return (
      <button
        type="button"
        className="icon-button dictation-button is-listening"
        aria-label="Stop dictation"
        title="Stop dictation"
        onClick={() => recognition.current?.stop()}
      >
        <MicOff size={16} />
      </button>
    );

  const items = [
    { label: "Dictation language", disabled: true, separator: false },
    ...DICTATION_LANGUAGES.map((l) => ({ label: l.label, selected: l.code === language, onSelect: () => choose(l.code) })),
  ];

  // The first use asks for the language; later uses start at once, and the language can be
  // changed from the menu next to it.
  return language ? (
    <span className="dictation-group">
      <button
        type="button"
        className="icon-button dictation-button"
        aria-label={`Dictate (${languageLabel ?? language})`}
        title={`Dictate (${languageLabel ?? language})`}
        disabled={disabled}
        onClick={() => start(language)}
      >
        <Mic size={16} />
      </button>
      <Dropdown
        label="Dictation language"
        side="top"
        align="end"
        trigger={
          <button type="button" className="dictation-language" aria-label="Change dictation language" disabled={disabled}>
            {language.split("-")[0]}
          </button>
        }
        items={items}
      />
    </span>
  ) : (
    <Dropdown
      label="Choose a dictation language"
      side="top"
      align="end"
      trigger={
        <button type="button" className="icon-button dictation-button" aria-label="Dictate" title="Dictate" disabled={disabled}>
          <Mic size={16} />
        </button>
      }
      items={items}
    />
  );
}
