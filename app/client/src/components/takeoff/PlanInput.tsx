import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cx } from './status';
import styles from './PlanInput.module.css';

export interface PlanInputProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  /** Invite plain language, one intent per line. Never ask for a format or YAML. */
  hint?: string;
}

export const PlanInput = forwardRef<HTMLTextAreaElement, PlanInputProps>(function PlanInput(
  { label = 'Your flight plan', hint, id, rows = 4, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cx(styles.plan, className)}>
      <label className={cx('type-eyebrow', styles.label)} htmlFor={inputId}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-describedby={hint ? hintId : undefined}
        className={cx('type-intent', styles.input)}
        {...rest}
      />
      {hint && (
        <p id={hintId} className={cx('type-small', styles.hint)}>
          {hint}
        </p>
      )}
    </div>
  );
});
