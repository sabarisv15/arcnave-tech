/**
 * A slides artifact's Markdown, cut into slides (ADR-0041).
 *
 * The rule is the PowerPoint export's (`backend/src/services/documents/parse.ts`,
 * `markdownToSlidesSpec`), so what the deck shows is what the download holds: a `#` or `##`
 * heading starts a slide, anything before the first heading is not on a slide, and a line
 * starting `Notes:` is that slide's speaker notes.
 */
export interface Slide {
  title: string;
  /** The slide's Markdown below its heading, without its notes. */
  body: string;
  notes: string;
}

const HEADING = /^\s*#{1,2}\s+(.+?)\s*#*\s*$/;
const NOTES = /^\s*(?:Notes:|<!--\s*notes:\s*)(.+?)(?:-->)?\s*$/i;

export function splitSlides(markdown: string): Slide[] {
  const slides: Slide[] = [];
  let current: { title: string; body: string[]; notes: string[] } | null = null;
  const close = () => {
    if (current) slides.push({ title: current.title, body: current.body.join("\n").trim(), notes: current.notes.join("\n") });
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    // `###` and deeper are content on the slide, as in the export.
    if (heading && !/^\s*###/.test(line)) {
      close();
      current = { title: heading[1]!, body: [], notes: [] };
      continue;
    }
    if (!current) continue;
    const notes = NOTES.exec(line);
    if (notes) current.notes.push(notes[1]!.trim());
    else current.body.push(line);
  }
  close();
  return slides;
}
