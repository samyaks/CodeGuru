import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './status';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'quiet' | 'night';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one beacon button per view. quiet: everything else. night: inside a VerdictPanel. */
  variant: ButtonVariant;
  size?: 'md' | 'sm';
  wide?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size = 'md', wide, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        size === 'sm' && styles.sm,
        wide && styles.wide,
        className,
      )}
      {...rest}
    />
  );
});
