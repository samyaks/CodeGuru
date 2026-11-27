import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import type { AskMessage, AskSource } from '../../services/askApi';
import { leaveProposal } from './handoff';
import styles from './Ask.module.css';

// One answer: the plain answer first, then where each part came from.
// Everything is shown as text. The server already took out anything a
// renderer could turn into a link or picture; this view never renders HTML
// or Markdown, so nothing in an answer can become one either.

const GITHUB = /^https:\/\/github\.com\/[^\s"'<>`]+$/i;

/** Where a source opens: a Takeoff page, a GitHub page or line range, or nowhere. */
export function sourceHref(projectId: string, s: AskSource): { to?: string; href?: string } {
  const project = `/read/${encodeURIComponent(projectId)}`;
  const pr = Number.isInteger(s.pr) && (s.pr as number) > 0 ? (s.pr as number) : null;
  switch (s.kind) {
    case 'agreement':
      return { to: `${project}#agreements-title` };
    case 'decision':
      return { to: `${project}/decisions` };
    case 'pr_check':
      return pr ? { to: `${project}/drift/${pr}` } : { to: project };
    case 'capability':
      return { to: project };
    default:
      return s.url && GITHUB.test(s.url) ? { href: s.url } : {};
  }
}

const KIND_WORD: Record<string, string> = {
  plan: 'Plan',
  agreement: 'Agreement',
  decision: 'Decision',
  pr_check: 'PR check',
  capability: 'Capability',
  commit: 'Commit',
  file: 'File',
  code: 'Code, not checked against the plan',
};

/** What the chip says under its label: the rule, the file and lines, or nothing. */
function detail(s: AskSource): string | null {
  if (s.kind === 'code' || s.kind === 'file') return s.path ? `${s.path}${s.lines ? `, lines ${s.lines}` : ''}` : null;
  if (s.kind === 'plan') return [s.area, s.text].filter(Boolean).join(': ') || null;
  if (s.kind === 'agreement' || s.kind === 'capability') return s.text || null;
  return null;
}

export function SourceChip({ projectId, source, anchor }: { projectId: string; source: AskSource; anchor: string }) {
  const where = sourceHref(projectId, source);
  const text = detail(source);
  const label = (
    <>
      <span className={styles.chipNumber}>{source.n}</span>
      <span className={styles.chipText}>
        <span className="type-small">{source.label || KIND_WORD[source.kind] || 'Source'}</span>
        {text ? <span className={cx('type-small', styles.muted, styles.chipDetail)}>{text}</span> : null}
      </span>
    </>
  );
  return (
    <li id={anchor} className={cx(styles.chip, source.kind === 'code' || source.kind === 'file' ? styles.chipCode : null)}>
      {where.to ? (
        <Link className={styles.chipLink} to={where.to}>{label}</Link>
      ) : where.href ? (
        <a className={styles.chipLink} href={where.href} target="_blank" rel="noreferrer noopener">{label}</a>
      ) : (
        <span className={styles.chipLink}>{label}</span>
      )}
    </li>
  );
}

export function AnswerView({ projectId, message }: { projectId: string; message: AskMessage }) {
  const navigate = useNavigate();
  const anchor = (n: number) => `ask-${message.id}-source-${n}`;
  const known = new Set(message.sources.map((s) => s.n));

  if (message.status === 'running') {
    return <p className={cx('type-body', styles.muted)} role="status">Takeoff is still answering this. Reload in a moment to see it.</p>;
  }
  if (message.status !== 'done' || !message.paragraphs.length) {
    // A failed answer, or one with nothing it could back up: the server's own words.
    return <p className={cx('type-body', styles.plain, message.status === 'failed' ? styles.muted : null)}>{message.content}</p>;
  }

  const propose = () => {
    if (!message.suggestedAgreement) return;
    leaveProposal(projectId, message.suggestedAgreement);
    navigate(`/read/${encodeURIComponent(projectId)}#agreements-title`);
  };

  return (
    <div className={styles.answer}>
      {message.planSilent || message.notBuilt ? (
        <div className={styles.callouts}>
          {message.planSilent ? (
            <p className={cx('type-small', styles.callout)}>
              <span className="type-heading">The plan doesn’t cover this.</span> Nothing in takeoff.yaml or the team’s agreements says how it should work.
            </p>
          ) : null}
          {message.notBuilt ? (
            <p className={cx('type-small', styles.callout)}>
              <span className="type-heading">Not built yet.</span> The plan asks for it, but Takeoff didn’t find it in the code.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.paragraphs}>
        {message.paragraphs.map((p, i) => (
          <p key={i} className={cx('type-body', styles.plain)}>
            {p.text}
            {p.refs.filter((n) => known.has(n)).map((n) => (
              <a key={n} className={styles.ref} href={`#${anchor(n)}`} aria-label={`Source ${n}`}>[{n}]</a>
            ))}
            {p.code_only ? <span className={cx('type-small', styles.muted, styles.codeOnly)}> From the code only, not checked against the plan.</span> : null}
          </p>
        ))}
      </div>

      {message.dropped > 0 ? (
        <p className={cx('type-small', styles.muted)}>
          {message.dropped === 1
            ? 'One part of this answer was left out because its source couldn’t be checked.'
            : `${message.dropped} parts of this answer were left out because their sources couldn’t be checked.`}
        </p>
      ) : null}
      {message.didntGetTo ? (
        <p className={cx('type-small', styles.muted, styles.plain)}>Not checked: {message.didntGetTo}</p>
      ) : null}

      {message.sources.length ? (
        <div className={styles.sources}>
          <p className={cx('type-eyebrow', styles.muted)}>Sources</p>
          <ol className={styles.chips}>
            {message.sources.map((s) => <SourceChip key={s.n} projectId={projectId} source={s} anchor={anchor(s.n)} />)}
          </ol>
        </div>
      ) : null}

      {message.suggestedAgreement ? (
        <div className={styles.suggest}>
          <p className={cx('type-small', styles.muted)}>The team could agree on this:</p>
          <p className={cx('type-body', styles.plain)}>{message.suggestedAgreement}</p>
          <div>
            <Button variant="quiet" size="sm" onClick={propose}>Propose as agreement</Button>
          </div>
          <p className={cx('type-small', styles.muted)}>This fills in the proposal form on the project page. Nothing is proposed until you press Propose there.</p>
        </div>
      ) : null}
    </div>
  );
}
