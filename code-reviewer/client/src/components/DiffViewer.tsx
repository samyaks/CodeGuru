import React from 'react';

interface Props {
  diff: string;
}

export default function DiffViewer({ diff }: Props) {
  const lines = diff.split('\n');

  return (
    <div className="diff-viewer">
      <pre>
        {lines.map((line, i) => {
          let cls = 'diff-line';
          if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
          else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-remove';
          else if (line.startsWith('@@')) cls += ' diff-hunk';

          return (
            <div key={i} className={cls}>
              <span className="diff-line-num">{i + 1}</span>
              <span className="diff-line-content">{line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
