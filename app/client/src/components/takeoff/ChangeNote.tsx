import { useId, useState } from 'react';
import { StatusMark } from './StatusMark';
import { cx, type Status } from './status';
import styles from './ChangeNote.module.css';

export interface ChangeNoteProps {
  /** What changed, as the person would notice it. */
  summary: string;
  status?: Status;
  /** A place in the app in the person's terms ("Checkout page"), never a file path. */
  where?: string;
  /** Hidden behind "Show the code". */
  code?: string;
  /** Only when the code is the only way to explain a Grounded result. */
  defaultOpen?: boolean;
}

export function ChangeNote({ summary, status, where, code, defaultOpen }: ChangeNoteProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const codeId = useId();
  return (
    <div className={styles.note}>
      <div className={styles.top}>
        <p className={cx('type-body', styles.summary)}>{summary}</p>
        {status && <StatusMark status={status} />}
      </div>
      {where && <span className={cx('type-small', styles.where)}>{where}</span>}
      {code && (
        <>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={codeId}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide the code' : 'Show the code'}
          </button>
          <pre id={codeId} className={cx('type-code', styles.code)} hidden={!open}>
            {code}
          </pre>
        </>
      )}
    </div>
  );
}
