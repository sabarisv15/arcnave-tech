import { Bookmark, ExternalLink } from 'lucide-react';
import type { SourcesBlock as SourcesBlockType } from '../types';

export function SourcesBlock({ block }: { block: SourcesBlockType }) {
  return (
    <div className="ui-sources-container" role="region" aria-label={block.title || 'Sources'}>
      <div className="ui-sources-header">
        <Bookmark size={15} />
        <h4>{block.title || 'Referenced Sources'}</h4>
      </div>

      <div className="ui-sources-list">
        {block.sources.map((src, idx) => (
          <div key={idx} className="ui-source-card">
            <div className="ui-source-meta">
              {src.publisher && <span className="ui-source-publisher">{src.publisher}</span>}
              {src.date && <span className="ui-source-date">{src.date}</span>}
            </div>

            <div className="ui-source-title">
              {src.url ? (
                <a href={src.url} target="_blank" rel="noopener noreferrer">
                  <span>{src.title || src.sourceRef}</span>
                  <ExternalLink size={12} />
                </a>
              ) : (
                <strong>{src.title || src.sourceRef}</strong>
              )}
            </div>

            {src.context && <p className="ui-source-context">{src.context}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
