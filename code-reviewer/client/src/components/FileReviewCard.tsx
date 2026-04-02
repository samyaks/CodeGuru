import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileCode, Wand2 } from 'lucide-react';
import SeverityBadge from './SeverityBadge';
import DiffViewer from './DiffViewer';
import HumanNotes from './HumanNotes';
import { ReviewFile, Finding, FixPromptSummary, updateFileComments } from '../services/api';

interface Props {
  file: ReviewFile;
  findings: Finding[];
  reviewId: string;
  fixPrompts?: FixPromptSummary[];
}

export default function FileReviewCard({ file, findings, reviewId, fixPrompts = [] }: Props) {
  const [expanded, setExpanded] = useState(file.severity === 'critical' || file.severity === 'warning');

  const findFixPrompt = (finding: Finding): FixPromptSummary | undefined => {
    return fixPrompts.find(
      (fp) =>
        fp.file_path === finding.file &&
        fp.issue_title === finding.title &&
        fp.severity === finding.severity
    );
  };

  return (
    <div className={`file-card file-card-${file.severity || 'ok'}`}>
      <div className="file-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="file-card-left">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <FileCode size={16} />
          <span className="file-card-path">{file.file_path}</span>
        </div>
        <div className="file-card-right">
          {findings.length > 0 && (
            <span className="file-card-count">{findings.length} finding{findings.length !== 1 ? 's' : ''}</span>
          )}
          <SeverityBadge severity={file.severity} size="sm" />
        </div>
      </div>

      {expanded && (
        <div className="file-card-body">
          {file.diff && <DiffViewer diff={file.diff} />}

          {findings.length > 0 && (
            <div className="file-findings">
              <h4>AI Findings</h4>
              {findings.map((f, i) => {
                const fix = findFixPrompt(f);
                return (
                  <div key={i} className={`finding finding-${f.severity}`}>
                    <div className="finding-header">
                      <SeverityBadge severity={f.severity} size="sm" />
                      <span className="finding-category">{f.category}</span>
                      {f.line && <span className="finding-line">Line {f.line}</span>}
                      {fix && (
                        <Link
                          to={`/fix/${fix.short_id}`}
                          className="fix-btn"
                          onClick={(e) => e.stopPropagation()}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Wand2 size={12} /> Fix with AI
                        </Link>
                      )}
                    </div>
                    <div className="finding-title">{f.title}</div>
                    <div className="finding-desc">{f.description}</div>
                  </div>
                );
              })}
            </div>
          )}

          <HumanNotes
            initial={file.human_comments || ''}
            onSave={(text) => updateFileComments(reviewId, file.id, text)}
            label="Your Comments on This File"
            placeholder="Add your review comments for this file..."
          />
        </div>
      )}
    </div>
  );
}
