import { Component, type ReactNode, useMemo } from 'react';
import type { SafeAction, UIBlock, UIResponseV1 } from './types';
import { TextBlock } from './blocks/TextBlock';
import { TableBlock } from './blocks/TableBlock';
import { MetricBlock } from './blocks/MetricBlock';
import { ChartBlock } from './blocks/ChartBlock';
import { ComparisonBlock } from './blocks/ComparisonBlock';
import { TimelineBlock } from './blocks/TimelineBlock';
import { StepsBlock } from './blocks/StepsBlock';
import { CardsBlock } from './blocks/CardsBlock';
import { SourcesBlock } from './blocks/SourcesBlock';
import { DashboardBlock } from './blocks/DashboardBlock';
import { VisualBlock } from './blocks/VisualBlock';

export class BlockErrorBoundary extends Component<
  { blockType: string; children: ReactNode },
  { hasError: boolean; error?: Error }
> {
  state: { hasError: boolean; error?: Error } = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(`BlockErrorBoundary caught error in [${this.props.blockType}]:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="ui-block-fallback"
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border, #e2e8f0)',
            background: 'var(--card, #ffffff)',
            color: 'var(--muted-foreground, #64748b)',
            fontSize: '13px',
            margin: '8px 0',
          }}
        >
          <p style={{ margin: 0 }}>
            Unable to display visual {this.props.blockType} component. Safe fallback preserved.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface GenerativeUIRendererProps {
  blocks?: UIBlock[];
  response?: UIResponseV1 | null;
  onAction?: (action: SafeAction) => void;
  /** The chat a visual belongs to, for "Save as artifact". */
  chatId?: string;
}

export function GenerativeUIRenderer({
  blocks = [],
  response,
  onAction,
  chatId,
}: GenerativeUIRendererProps) {
  const activeBlocks = useMemo(() => {
    const raw = response ? response.blocks : blocks;
    if (!Array.isArray(raw)) return [];
    // Deduplicate by blockId to ensure idempotency across SSE reconnections
    const seen = new Set<string>();
    const unique: UIBlock[] = [];
    for (const b of raw) {
      if (!b || typeof b !== 'object' || !b.type) continue;
      const id = b.blockId || `anon_${unique.length}`;
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(b);
      }
    }
    return unique;
  }, [blocks, response]);

  if (activeBlocks.length === 0) return null;

  return (
    <div className="ui-generative-response" role="region" aria-label="Interactive generative UI">
      {activeBlocks.map((block, idx) => {
        const key = block.blockId || `blk_${idx}`;
        const renderBlock = () => {
          switch (block.type) {
            case 'text':
              return <TextBlock block={block} />;
            case 'table':
              return <TableBlock block={block} />;
            case 'metric':
              return <MetricBlock block={block} />;
            case 'chart':
              return <ChartBlock block={block} />;
            case 'comparison':
              return <ComparisonBlock block={block} />;
            case 'timeline':
              return <TimelineBlock block={block} />;
            case 'steps':
              return <StepsBlock block={block} />;
            case 'cards':
              return <CardsBlock block={block} onAction={onAction} />;
            case 'sources':
              return <SourcesBlock block={block} />;
            case 'dashboard':
              return <DashboardBlock block={block} />;
            case 'visual':
              return <VisualBlock block={block} chatId={chatId} />;
            default:
              return null;
          }
        };

        return (
          <BlockErrorBoundary key={key} blockType={block.type}>
            {renderBlock()}
          </BlockErrorBoundary>
        );
      })}
    </div>
  );
}

export default GenerativeUIRenderer;

