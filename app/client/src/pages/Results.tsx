import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, Download, Loader, Copy, Check, AlertTriangle, CheckCircle, BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import Header from '../components/Header';
import { fetchAnalysis } from '../services/api';

interface ContextFile {
  path: string;
  content: string;
  type: 'existing' | 'gap';
}

interface AnalysisData {
  id: string;
  repo_url: string;
  owner: string;
  repo: string;
  status: string;
  completion_pct: number;
  context_files: ContextFile[];
  features_summary: string | null;
  analysis: any;
}

export default function Results() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchAnalysis(id)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [id]);

  const copyToClipboard = async (content: string, idx: number) => {
    await navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const copySummary = async () => {
    if (!data?.features_summary) return;
    await navigator.clipboard.writeText(data.features_summary);
    setSummaryCopied(true);
    setTimeout(() => setSummaryCopied(false), 2000);
  };

  const downloadFile = (file: ContextFile) => {
    const blob = new Blob([file.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.replace(/\//g, '-');
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    if (!data?.context_files) return;
    for (const file of data.context_files) {
      downloadFile(file);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader size={32} className="animate-spin text-gold" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen">
        <Header backTo="/dashboard" title="Error" />
        <main className="max-w-4xl mx-auto px-6 py-12 text-center">
          <p className="text-red-600">{error || 'Analysis not found'}</p>
          <Link to="/" className="text-gold underline mt-4 inline-block">Go back</Link>
        </main>
      </div>
    );
  }

  const contextFiles = data.context_files || [];
  const existingFiles = contextFiles.filter((f) => f.type === 'existing');
  const gapFiles = contextFiles.filter((f) => f.type === 'gap');
  const gaps = data.analysis?.gaps;

  return (
    <div className="min-h-screen">
      <Header backTo="/dashboard" title="Results">
        <span className="text-sm text-sky-muted">{data.owner}/{data.repo}</span>
      </Header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Plain-English explanation — the main thing */}
        {data.features_summary && (
          <FeaturesSummary
            summary={data.features_summary}
            copied={summaryCopied}
            onCopy={copySummary}
          />
        )}

        {/* Completion overview */}
        <div className="bg-navy border border-sky-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Completion</h2>
            <span className="text-2xl font-bold text-gold">{data.completion_pct || 0}%</span>
          </div>
          <div className="w-full h-3 bg-navy-mid rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold to-gold-dim rounded-full transition-all duration-500"
              style={{ width: `${data.completion_pct || 0}%` }}
            />
          </div>
          {gaps && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(gaps).map(([key, val]: [string, any]) => (
                <span
                  key={key}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                    val.exists
                      ? 'bg-green-500/10 text-emerald-600 border border-green-500/20'
                      : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                  }`}
                >
                  {val.exists ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                  {key}
                </span>
              ))}
            </div>
          )}
        </div>

        {contextFiles.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={downloadAll}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gold hover:bg-gold-dim text-ink text-sm font-medium transition-colors"
            >
              <Download size={14} />
              Download all context files
            </button>
          </div>
        )}

        {existingFiles.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText size={20} className="text-emerald-600" />
              Existing Code Context
              <span className="text-xs bg-green-500/10 text-emerald-600 px-2 py-0.5 rounded-full">{existingFiles.length}</span>
            </h2>
            {existingFiles.map((file, i) => (
              <ContextCard
                key={i}
                file={file}
                copied={copiedIdx === i}
                onCopy={() => copyToClipboard(file.content, i)}
              />
            ))}
          </div>
        )}

        {gapFiles.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-600" />
              Needs Building
              <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">{gapFiles.length}</span>
            </h2>
            {gapFiles.map((file, i) => (
              <ContextCard
                key={i}
                file={file}
                copied={copiedIdx === existingFiles.length + i}
                onCopy={() => copyToClipboard(file.content, existingFiles.length + i)}
              />
            ))}
          </div>
        )}

        {contextFiles.length === 0 && !data.features_summary && (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
            <FileText size={48} className="text-border-dark" />
            <h2 className="text-xl font-semibold text-sky-off">No results generated</h2>
            <p className="text-sky-muted">The analysis may still be in progress.</p>
          </div>
        )}
      </main>
    </div>
  );
}


function FeaturesSummary({ summary, copied, onCopy }: { summary: string; copied: boolean; onCopy: () => void }) {
  const sections = parseSummaryIntoSections(summary);

  return (
    <div className="bg-gradient-to-br from-gold/5 to-navy border border-gold/20 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gold/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gold/10">
            <BookOpen size={20} className="text-gold" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink">What this project does</h2>
            <p className="text-xs text-sky-muted">Plain-English explanation — no technical jargon</p>
          </div>
        </div>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gold/10 hover:bg-gold/20 text-gold border border-gold/20 transition-colors"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="px-6 py-5 space-y-5">
        {sections.map((section, i) => (
          <SummarySection key={i} title={section.title} content={section.content} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}

function SummarySection({ title, content, defaultOpen }: { title: string; content: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left group"
      >
        {open
          ? <ChevronDown size={16} className="text-gold flex-shrink-0" />
          : <ChevronRight size={16} className="text-sky-muted group-hover:text-gold flex-shrink-0" />
        }
        <h3 className="text-sm font-semibold text-gold group-hover:text-ink transition-colors">
          {title}
        </h3>
      </button>
      {open && (
        <div className="mt-2 ml-6 text-sm text-sky-off leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

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


function ContextCard({ file, copied, onCopy }: { file: ContextFile; copied: boolean; onCopy: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-navy border border-sky-border rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-navy-mid transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            file.type === 'existing'
              ? 'bg-green-500/10 text-emerald-600'
              : 'bg-amber-500/10 text-amber-600'
          }`}>
            {file.type === 'existing' ? 'existing' : 'needs building'}
          </span>
          <code className="text-sm text-sky-off">{file.path}</code>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-navy-mid hover:bg-navy-mid text-sky-off transition-colors"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-sky-border px-4 py-4 max-h-96 overflow-auto">
          <pre className="text-sm text-sky-off whitespace-pre-wrap font-mono leading-relaxed">{file.content}</pre>
        </div>
      )}
    </div>
  );
}
