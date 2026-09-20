import { ArrowUpRight, ExternalLink } from 'lucide-react';
import type { CardsBlock as CardsBlockType, SafeAction } from '../types';

export function CardsBlock({
  block,
  onAction,
}: {
  block: CardsBlockType;
  onAction?: (action: SafeAction) => void;
}) {
  const layoutClass = block.layout === 'list' ? 'layout-list' : 'layout-grid';

  return (
    <div className="ui-cards-container" role="region" aria-label={block.title || 'Cards'}>
      {block.title && <h4 className="ui-cards-title">{block.title}</h4>}

      <div className={`ui-cards-wrapper ${layoutClass}`}>
        {block.cards.map((card) => (
          <div key={card.id} className="ui-card-item">
            {card.imageRef && (
              <div className="ui-card-image">
                <img src={card.imageRef} alt={card.title} loading="lazy" />
              </div>
            )}

            <div className="ui-card-body">
              <div className="ui-card-header">
                <strong>{card.title}</strong>
                {card.subtitle && <small className="ui-card-subtitle">{card.subtitle}</small>}
              </div>

              {card.description && <p className="ui-card-desc">{card.description}</p>}

              {card.metadata && Object.keys(card.metadata).length > 0 && (
                <div className="ui-card-metadata">
                  {Object.entries(card.metadata).map(([k, v]) => (
                    <span key={k} className="ui-card-meta-chip">
                      <strong>{k}:</strong> {v}
                    </span>
                  ))}
                </div>
              )}

              {card.action && (
                <div className="ui-card-action">
                  <button
                    className="button quiet-button"
                    onClick={() => onAction?.(card.action!)}
                  >
                    <span>
                      {card.action.actionType === 'open_artifact' && 'Open artifact'}
                      {card.action.actionType === 'view_source' && 'View source'}
                      {card.action.actionType === 'filter_view' && 'Filter view'}
                    </span>
                    {card.action.actionType === 'open_artifact' ? (
                      <ArrowUpRight size={14} />
                    ) : (
                      <ExternalLink size={13} />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
