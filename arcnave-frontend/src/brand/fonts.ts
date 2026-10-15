// Self-hosted brand fonts (all OFL, bundled with the app so no page load depends on another host).
// Brand-Locked "Typography": Onest for the app UI, Source Serif 4 for AI answers and sign-in pages,
// Noto Serif Tamil for Tamil answers, Noto Sans Tamil for Tamil UI text, JetBrains Mono for code.
// All are variable fonts, so the W2 weights (500 body/menu, 600 labels/buttons, 700 headings, plus
// 450/650 for the serif answer text) are inside the loaded ranges.
// Hindi (Noto Sans Devanagari) is on the sheet but is not self-hosted yet.
import "@fontsource-variable/onest";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/noto-serif-tamil";
import "@fontsource-variable/noto-sans-tamil";
import "@fontsource-variable/jetbrains-mono";
