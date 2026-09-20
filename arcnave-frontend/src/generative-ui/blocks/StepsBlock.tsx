import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { StepsBlock as StepsBlockType } from '../types';

export function StepsBlock({ block }: { block: StepsBlockType }) {
  return (
    <div className="ui-steps-container" role="region" aria-label={block.title || 'Workflow steps'}>
      {block.title && <h4 className="ui-steps-title">{block.title}</h4>}

      <div className="ui-steps-list">
        {block.steps.map((step) => {
          return (
            <div key={step.index} className={`ui-step-item status-${step.status}`}>
              <div className="ui-step-indicator">
                {step.status === 'complete' && <CheckCircle2 size={18} className="text-emerald-500" />}
                {step.status === 'active' && <Loader2 size={18} className="text-blue-500 spin" />}
                {step.status === 'blocked' && <XCircle size={18} className="text-rose-500" />}
                {step.status === 'pending' && <Circle size={16} className="text-muted-foreground" />}
                <span className="ui-step-number">{step.index}</span>
              </div>

              <div className="ui-step-content">
                <div className="ui-step-header">
                  <strong>{step.title}</strong>
                  <span className={`ui-step-status-chip chip-${step.status}`}>
                    {step.status}
                  </span>
                </div>
                {step.description && <p className="ui-step-description">{step.description}</p>}
                {step.codeSnippet && (
                  <pre className="ui-step-code" tabIndex={0}>
                    <code>{step.codeSnippet}</code>
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
