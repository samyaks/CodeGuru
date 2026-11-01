import { forwardRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cx } from './status';
import type { ButtonVariant } from './Button';
import styles from './Button.module.css';

export interface ButtonLinkProps extends LinkProps {
  /** Same rules as Button: one primary per view. */
  variant: ButtonVariant;
  size?: 'md' | 'sm';
  wide?: boolean;
}

// A router link that looks like a Button, for actions that go somewhere.
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant, size = 'md', wide, className, ...rest },
  ref,
) {
  return (
    <Link
      ref={ref}
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
