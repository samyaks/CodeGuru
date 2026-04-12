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

function SummarySection({ title, content, defaultOpen }: { title: string; content: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 w-full text-left group">
        {open
          ? <ChevronDown size={16} className="text-gold shrink-0" />
          : <ChevronRight size={16} className="text-sky-muted group-hover:text-gold shrink-0" />}
        <h3 className="text-sm font-semibold text-gold group-hover:text-gold-dim transition-colors">{title}</h3>
      </button>
      {open && (
        <div className="mt-2 ml-6 text-sm text-sky-off leading-relaxed whitespace-pre-wrap">{content}</div>
      )}
    </div>
  );
}

export default function FeaturesSummary({ summary }: { summary: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const sections = parseSummaryIntoSections(summary);

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); };
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
    <div className="rounded-xl border border-gold/20 bg-navy overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gold/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gold/10">
            <BookOpen size={20} className="text-gold" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-sky-white">What this project does</h2>
            <p className="text-xs text-sky-muted">Plain-English explanation — no technical jargon</p>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gold/10 hover:bg-gold/20 text-gold border border-gold/20 transition-colors"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="px-5 py-5 space-y-5">
        {sections.map((section, i) => (
          <SummarySection key={i} title={section.title} content={section.content} defaultOpen={i < 3} />
        ))}
      </div>
    </div>
  );
}
