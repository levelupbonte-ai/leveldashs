import { Fragment } from 'react';
import { parseMarkdown, type MdBlock, type MdInline } from '@/lib/markdown';
import { cn } from '@/lib/utils';

/**
 * Renders trusted-format Markdown (contracts, LevelUp documents) as React
 * elements. No `dangerouslySetInnerHTML`: raw HTML in the source is shown as
 * text, and only http(s)/mailto links are kept (see `@/lib/markdown`).
 */

function Inline({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>;
          case 'strong':
            return (
              <strong key={i} className='text-foreground font-semibold'>
                <Inline nodes={node.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <Inline nodes={node.children} />
              </em>
            );
          case 'code':
            return (
              <code key={i} className='bg-muted rounded px-1 py-0.5 text-[0.9em]'>
                {node.text}
              </code>
            );
          case 'link':
            return (
              <a
                key={i}
                href={node.href}
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary underline underline-offset-4'
              >
                <Inline nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case 'heading': {
      const classes = {
        1: 'text-2xl font-semibold tracking-tight',
        2: 'mt-8 scroll-mt-20 border-b pb-2 text-lg font-semibold tracking-tight first:mt-0',
        3: 'mt-6 text-base font-semibold',
        4: 'mt-4 text-sm font-semibold'
      } as const;
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
      return (
        <Tag className={classes[block.level]}>
          <Inline nodes={block.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              <Inline nodes={line} />
            </Fragment>
          ))}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn('space-y-1.5 ps-5', block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, i) => (
            <li key={i} className='ps-1'>
              <Inline nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className='bg-muted/50 border-primary/40 space-y-3 rounded-e-lg border-s-2 px-4 py-3'>
          {block.children.map((child, i) => (
            <Block key={i} block={child} />
          ))}
        </blockquote>
      );
    case 'table':
      return (
        <div className='-mx-1 overflow-x-auto px-1'>
          <table className='w-full min-w-[28rem] border-collapse text-left text-sm'>
            <thead>
              <tr className='border-b'>
                {block.header.map((cell, i) => (
                  <th key={i} scope='col' className='text-foreground px-3 py-2 font-semibold'>
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className='border-b last:border-0'>
                  {row.map((cell, c) => (
                    <td key={c} className='px-3 py-2 align-top'>
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className='my-6' />;
  }
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div
      className={cn(
        'text-muted-foreground space-y-4 text-[0.938rem] leading-relaxed break-words',
        className
      )}
    >
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
