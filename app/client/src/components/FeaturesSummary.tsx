import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, BookOpen, Copy, Check } from 'lucide-react';

function parseSummaryIntoSections(text: string): { title: string; content: string }[] {
  const lines = text.split('\n');
  const sections: { title: string; content: string }[] = [];
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
      }
      currentTitle = headingMatch[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
  }
  if (sections.length === 0) {
    sections.push({ title: 'Summary', content: text.trim() });
  }
  return sections;
}

function SummarySection({
  title,
  content,
  defaultOpen,
}: {
  title: string;
  content: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2 w-full text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded"
      >
        {open ? (
          <ChevronDown size={16} className="text-brand shrink-0" />
        ) : (
          <ChevronRight
            size={16}
            className="text-text-faint group-hover:text-brand shrink-0 transition-colors"
          />
        )}
        <h3 className="text-sm font-semibold text-brand group-hover:text-brand-hov transition-colors">
          {title}
        </h3>
      </button>
      {open && (
        <div className="mt-2 ml-6 text-sm text-text-soft leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

export default function FeaturesSummary({ summary }: { summary: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const sections = parseSummaryIntoSections(summary);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = summary;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-[14px] border border-line bg-surface overflow-hidden shadow-card">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-divider gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-brand-tint border border-brand-tint-border shrink-0">
            <BookOpen size={18} className="text-brand" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text truncate">
              What this project does
            </h2>
            <p className="text-[11px] text-text-faint">
              Plain-English explanation &mdash; no technical jargon
            </p>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-tint hover:bg-brand-tint-2 text-brand border border-brand-tint-border transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="px-5 py-5 flex flex-col gap-5">
        {sections.map((section, i) => (
          <SummarySection
            key={i}
            title={section.title}
            content={section.content}
            defaultOpen={i < 3}
          />
        ))}
      </div>
    </div>
  );
}
