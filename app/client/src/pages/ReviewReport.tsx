import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader, AlertTriangle, CheckCircle, Info, FileText, ExternalLink } from 'lucide-react';
import Header from '../components/Header';
import { fetchReview, fetchFixPrompts } from '../services/api';

interface Finding {
  file: string;
  line: number | null;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
}

interface ReviewData {
  id: string;
  type: string;
  owner: string;
  repo: string;
  pr_number: number | null;
  status: string;
  ai_report: string | null;
  files: any[];
}

interface FixPrompt {
  id: string;
  short_id: string;
  file_path: string;
  issue_title: string;
  severity: string;
}

export default function ReviewReport() {
  const { id } = useParams<{ id: string }>();
  const [review, setReview] = useState<ReviewData | null>(null);
  const [report, setReport] = useState<any>(null);
  const [fixPrompts, setFixPrompts] = useState<FixPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetchReview(id),
      fetchFixPrompts(id),
    ]).then(([r, fp]) => {
      setReview(r);
      setFixPrompts(fp);
      if (r.ai_report) {
        try {
          setReport(typeof r.ai_report === 'string' ? JSON.parse(r.ai_report) : r.ai_report);
        } catch {
          setReport(null);
        }
      }
      setLoading(false);
    }).catch((e) => {
      setError(e.message);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader size={32} className="animate-spin text-gold" />
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="min-h-screen">
        <Header backTo="/dashboard" title="Error" />
        <main className="max-w-4xl mx-auto px-6 py-12 text-center">
          <p className="text-red-600">{error || 'Review not found'}</p>
          <Link to="/dashboard" className="text-gold underline mt-4 inline-block">Go back</Link>
        </main>
      </div>
    );
  }

  const findings: Finding[] = report?.findings || [];
  const critical = findings.filter((f) => f.severity === 'critical');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const infos = findings.filter((f) => f.severity === 'info');

  return (
    <div className="min-h-screen">
      <Header backTo="/dashboard">
        <div>
          <h1 className="text-lg font-semibold">
            {review.owner}/{review.repo}
            {review.pr_number && <span className="text-sky-muted"> #{review.pr_number}</span>}
          </h1>
          <p className="text-xs text-sky-muted">{review.type} review</p>
        </div>
      </Header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {report?.summary && (
          <div className="bg-navy border border-sky-border rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-2">Summary</h2>
            <p className="text-sky-off text-sm leading-relaxed">{report.summary}</p>
            {report.verdict && (
              <span className={`inline-block mt-3 px-3 py-1 rounded-full text-xs font-medium ${
                report.verdict === 'approve' ? 'bg-green-500/10 text-emerald-600 border border-green-500/20' :
                report.verdict === 'request_changes' ? 'bg-red-500/10 text-red-600 border border-red-500/20' :
                'bg-amber-500/10 text-amber-600 border border-amber-500/20'
              }`}>
                {report.verdict.replace('_', ' ')}
              </span>
            )}
          </div>
        )}

        {report?.stats && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total', value: report.stats.totalFindings, color: 'text-ink' },
              { label: 'Critical', value: report.stats.critical, color: 'text-red-600' },
              { label: 'Warnings', value: report.stats.warnings, color: 'text-amber-600' },
              { label: 'Info', value: report.stats.info, color: 'text-blue-600' },
            ].map((s) => (
              <div key={s.label} className="bg-navy border border-sky-border rounded-xl p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-sky-muted mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {critical.length > 0 && <FindingsSection title="Critical" findings={critical} icon={<AlertTriangle size={18} className="text-red-600" />} />}
        {warnings.length > 0 && <FindingsSection title="Warnings" findings={warnings} icon={<AlertTriangle size={18} className="text-amber-600" />} />}
        {infos.length > 0 && <FindingsSection title="Info" findings={infos} icon={<Info size={18} className="text-blue-600" />} />}

        {fixPrompts.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText size={20} className="text-gold" />
              Fix Prompts
              <span className="text-xs bg-gold/10 text-gold px-2 py-0.5 rounded-full">{fixPrompts.length}</span>
            </h2>
            {fixPrompts.map((fp) => (
              <Link
                key={fp.id}
                to={`/fix/${fp.short_id}`}
                className="block bg-navy border border-sky-border rounded-xl px-5 py-3 hover:border-gold/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{fp.issue_title}</p>
                    <p className="text-xs text-sky-muted mt-0.5">{fp.file_path}</p>
                  </div>
                  <ExternalLink size={14} className="text-border-dark" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {!report && (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
            <FileText size={48} className="text-border-dark" />
            <h2 className="text-xl font-semibold text-sky-off">No report available</h2>
            <p className="text-sky-muted">This review may still be processing.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function FindingsSection({ title, findings, icon }: { title: string; findings: Finding[]; icon: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        {icon}
        {title}
        <span className="text-xs bg-navy-mid text-sky-muted px-2 py-0.5 rounded-full">{findings.length}</span>
      </h2>
      {findings.map((f, i) => (
        <div key={i} className="bg-navy border border-sky-border rounded-xl px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm">{f.title}</p>
              <p className="text-xs text-sky-muted mt-0.5">
                {f.file}{f.line ? `:${f.line}` : ''} &middot; {f.category}
              </p>
            </div>
            <SeverityBadge severity={f.severity} />
          </div>
          <p className="text-sm text-sky-muted mt-2 leading-relaxed">{f.description}</p>
        </div>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-500/10 text-red-600 border-red-500/20',
    warning: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    info: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  };
  return (
    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border ${styles[severity] || styles.info}`}>
      {severity}
    </span>
  );
}
