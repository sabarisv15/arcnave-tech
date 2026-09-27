import { useCallback, useEffect, useState } from 'react';
import { Download, Image as ImageIcon, Maximize2, Minimize2, Save } from 'lucide-react';
import type { VisualBlock as VisualBlockType } from '../types';
import { SandboxFrame } from '../../SandboxFrame';
import { useWorkspace } from '../../workspace';

/** An SVG document once any XML declaration, doctype and comments before it are skipped. */
export function isSvgRoot(html: string): boolean {
  const rest = html
    .trimStart()
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^(?:<!--[\s\S]*?-->\s*|<!doctype[^>]*>\s*)*/i, '');
  return /^<svg[\s>]/i.test(rest);
}

/**
 * Text for the composer, which the user still has to send. A visual's script is untrusted, so
 * it never sends in the user's name (ADR-0035, decision 4). Composer listens for this event.
 */
export const COMPOSE_EVENT = 'arcnave:compose';
export function suggestPrompt(text: string): void {
  window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { text } }));
}

function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function fileName(title: string): string {
  return title.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'visual';
}

/**
 * Draws the SVG text to a canvas in ArcNave's page. An SVG loaded as an image never runs its
 * scripts, so this reads nothing from the frame.
 */
async function svgToPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg did not load'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function VisualBlock({ block, chatId }: { block: VisualBlockType; chatId?: string }) {
  const { saveVisualAsArtifact, toast, readOnly } = useWorkspace();
  const [full, setFull] = useState(false);
  const html = block.html ?? '';
  const svg = isSvgRoot(html);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const onPrompt = useCallback((text: string) => {
    suggestPrompt(text);
    toast('Suggested follow-up added to the message box');
  }, [toast]);

  if (!html) {
    return (
      <div className="ui-visual ui-visual-missing" role="note">
        <p>{block.title}: this visual is no longer available.</p>
      </div>
    );
  }

  const copyImage = async () => {
    try {
      const png = await svgToPng(html);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Image copied');
    } catch {
      toast('The image could not be copied');
    }
  };

  return (
    <figure className={`ui-visual ${full ? 'ui-visual-full' : ''}`} aria-label={block.title}>
      <figcaption className="ui-visual-header">
        <span className="ui-visual-title">{block.title}</span>
        <span className="ui-visual-actions">
          <button type="button" onClick={() => setFull((f) => !f)} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            {full ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
          </button>
          {svg && (
            <>
              <button type="button" onClick={() => void copyImage()} aria-label="Copy as image">
                <ImageIcon size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => download(`${fileName(block.title)}.svg`, 'image/svg+xml', html)}
                aria-label="Download SVG"
              >
                <Download size={13} aria-hidden="true" />
                <span>SVG</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => download(`${fileName(block.title)}.html`, 'text/html', html)}
            aria-label="Download HTML"
          >
            <Download size={13} aria-hidden="true" />
            <span>HTML</span>
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => saveVisualAsArtifact({ title: block.title, html, kind: svg ? 'svg' : 'webpage', chatId })}
              aria-label="Save as artifact"
            >
              <Save size={13} aria-hidden="true" />
            </button>
          )}
        </span>
      </figcaption>
      <SandboxFrame html={html} title={block.title} autoHeight={!full} onPrompt={readOnly ? undefined : onPrompt} />
    </figure>
  );
}
