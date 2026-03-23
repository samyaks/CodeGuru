import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode } from 'lucide-react';
import SeverityBadge from './SeverityBadge';
import DiffViewer from './DiffViewer';
import HumanNotes from './HumanNotes';
import { ReviewFile, Finding, updateFileComments } from '../services/api';

interface Props {
  file: ReviewFile;
  findings: Finding[];
  reviewId: string;
}

export default function FileReviewCard({ file, findings, reviewId }: Props) {
  const [expanded, setExpanded] = useState(file.severity === 'critical' || file.severity === 'warning');

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
              {findings.map((f, i) => (
                <div key={i} className={`finding finding-${f.severity}`}>
                  <div className="finding-header">
                    <SeverityBadge severity={f.severity} size="sm" />
                    <span className="finding-category">{f.category}</span>
                    {f.line && <span className="finding-line">Line {f.line}</span>}
                  </div>
                  <div className="finding-title">{f.title}</div>
                  <div className="finding-desc">{f.description}</div>
                </div>
              ))}
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
