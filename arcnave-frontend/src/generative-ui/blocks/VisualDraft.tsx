import { SandboxFrame } from '../../SandboxFrame';
import type { VisualDraft as VisualDraftType } from '../../types';

/**
 * A visual while the model is still writing it (ADR-0037). It is drawn in the same sandbox as
 * the finished one, as markup only; the finished block, checked and with its scripts, replaces
 * it. No actions: there is nothing finished to save or download yet.
 */
export function VisualDraft({ draft }: { draft: VisualDraftType }) {
  return (
    <figure className="ui-visual ui-visual-draft" aria-label={draft.title || 'Visual'} aria-busy="true">
      <figcaption className="ui-visual-header">
        <span className="ui-visual-title">{draft.title}</span>
        <span className="ui-visual-drawing">Drawing…</span>
      </figcaption>
      <SandboxFrame html={draft.html} title={draft.title || 'Visual'} autoHeight draft />
    </figure>
  );
}
