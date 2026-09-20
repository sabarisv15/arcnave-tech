import { useMemo } from 'react';
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

export interface GenerativeUIRendererProps {
  blocks?: UIBlock[];
  response?: UIResponseV1 | null;
  onAction?: (action: SafeAction) => void;
}

export function GenerativeUIRenderer({
  blocks = [],
  response,
  onAction,
}: GenerativeUIRendererProps) {
  const activeBlocks = useMemo(() => {
    const raw = response ? response.blocks : blocks;
    // Deduplicate by blockId to ensure idempotency across SSE reconnections
    const seen = new Set<string>();
    const unique: UIBlock[] = [];
    for (const b of raw) {
      if (!b || !b.type) continue;
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
      {activeBlocks.map((block) => {
        switch (block.type) {
          case 'text':
            return <TextBlock key={block.blockId} block={block} />;
          case 'table':
            return <TableBlock key={block.blockId} block={block} />;
          case 'metric':
            return <MetricBlock key={block.blockId} block={block} />;
          case 'chart':
            return <ChartBlock key={block.blockId} block={block} />;
          case 'comparison':
            return <ComparisonBlock key={block.blockId} block={block} />;
          case 'timeline':
            return <TimelineBlock key={block.blockId} block={block} />;
          case 'steps':
            return <StepsBlock key={block.blockId} block={block} />;
          case 'cards':
            return <CardsBlock key={block.blockId} block={block} onAction={onAction} />;
          case 'sources':
            return <SourcesBlock key={block.blockId} block={block} />;
          case 'dashboard':
            return <DashboardBlock key={block.blockId} block={block} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

export default GenerativeUIRenderer;
