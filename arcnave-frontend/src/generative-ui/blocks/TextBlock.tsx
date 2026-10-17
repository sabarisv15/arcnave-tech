import ReactMarkdown from 'react-markdown';
import { normalizeMathDelimiters, remarkPlugins, rehypePlugins, sharedMarkdownComponents } from '../../markdownPlugins';
import type { TextBlock as TextBlockType } from '../types';

export function TextBlock({ block }: { block: TextBlockType }) {
  return (
    <div className="ui-text-block">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={sharedMarkdownComponents}
      >
        {normalizeMathDelimiters(block.text)}
      </ReactMarkdown>
    </div>
  );
}
