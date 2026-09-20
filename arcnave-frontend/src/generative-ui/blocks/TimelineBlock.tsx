import { CheckCircle2, Clock, AlertCircle, Circle } from 'lucide-react';
import type { TimelineBlock as TimelineBlockType } from '../types';

export function TimelineBlock({ block }: { block: TimelineBlockType }) {
  return (
    <div className="ui-timeline-container" role="region" aria-label={block.title || 'Timeline'}>
      {block.title && <h4 className="ui-timeline-title">{block.title}</h4>}

      <div className="ui-timeline-items">
        {block.events.map((evt, idx) => {
          const status = evt.status || 'upcoming';
          return (
            <div key={evt.id || idx} className={`ui-timeline-item status-${status}`}>
              <div className="ui-timeline-marker">
                {status === 'completed' && <CheckCircle2 size={16} className="text-emerald-500" />}
                {status === 'in_progress' && <Clock size={16} className="text-blue-500 animate-pulse" />}
                {status === 'blocked' && <AlertCircle size={16} className="text-rose-500" />}
                {status === 'upcoming' && <Circle size={14} className="text-muted-foreground" />}
                {idx < block.events.length - 1 && <div className="ui-timeline-line" />}
              </div>

              <div className="ui-timeline-content">
                <div className="ui-timeline-meta">
                  <span className="ui-timeline-date">{evt.dateOrPeriod}</span>
                  {status !== 'upcoming' && (
                    <span className={`ui-timeline-status-badge badge-${status}`}>
                      {status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <h5 className="ui-timeline-heading">{evt.title}</h5>
                {evt.description && <p className="ui-timeline-desc">{evt.description}</p>}
                {evt.sourceRef && (
                  <span className="ui-timeline-source">Ref: {evt.sourceRef}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
