const VISIBLE = 8;
const ROW_PX = 20;

export interface FileTickerProps {
  paths: string[];
  readCount?: number;
  totalToRead?: number;
  className?: string;
}

/**
 * Scrolling list of file paths as the analyzer reads them. Newest at the
 * bottom; older rows fade. Height is reserved even when empty so the
 * layout doesn't jump when the first batch lands.
 */
export default function FileTicker({
  paths,
  readCount,
  totalToRead,
  className = '',
}: FileTickerProps) {
  const visible = paths.slice(-VISIBLE);
  const pad = Math.max(0, VISIBLE - visible.length);
  const hasCounts = typeof readCount === 'number' && typeof totalToRead === 'number' && totalToRead > 0;

  return (
    <div className={className}>
      <div
        className="relative overflow-hidden rounded-lg bg-surface border border-line px-3 py-2"
        style={{ height: VISIBLE * ROW_PX + 16 }}
        aria-hidden="true"
      >
        <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-surface to-transparent pointer-events-none z-10" />
        <ul className="flex flex-col justify-end h-full">
          {Array.from({ length: pad }).map((_, i) => (
            <li key={`pad-${i}`} style={{ height: ROW_PX }} />
          ))}
          {visible.map((path, i) => {
            const age = visible.length - 1 - i;
            const opacity = age === 0 ? 1 : Math.max(0.28, 1 - age * 0.1);
            return (
              <li
                key={`${path}-${paths.length - visible.length + i}`}
                className="font-mono text-[11px] text-text-soft truncate"
                style={{ height: ROW_PX, lineHeight: `${ROW_PX}px`, opacity }}
              >
                {path}
              </li>
            );
          })}
        </ul>
        {visible.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-text-faint">
            Fetching key files…
          </p>
        )}
      </div>
      {hasCounts && (
        <p className="mt-1.5 text-[11px] text-text-faint" aria-live="polite">
          {readCount} of {totalToRead} files
        </p>
      )}
    </div>
  );
}
