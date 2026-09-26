import ReactMarkdown from 'react-markdown';
import { remarkPlugins, rehypePlugins } from '../../markdownPlugins';
import type { TextBlock as TextBlockType } from '../types';

export function TextBlock({ block }: { block: TextBlockType }) {
  return (
    <div className="ui-text-block">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {block.text}
      </ReactMarkdown>
    </div>
  );
}
