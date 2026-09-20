import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { TextBlock as TextBlockType } from '../types';

export function TextBlock({ block }: { block: TextBlockType }) {
  return (
    <div className="ui-text-block">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {block.text}
      </ReactMarkdown>
    </div>
  );
}
