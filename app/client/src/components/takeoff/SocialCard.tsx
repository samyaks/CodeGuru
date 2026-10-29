import type { CSSProperties, ReactNode } from 'react';
import { StatusIcon } from './StatusIcon';
import { STATUS, cx, type Status } from './status';
import styles from './SocialCard.module.css';

export type SocialFormat = 'square' | 'portrait' | 'story' | 'landscape';
export type SocialKind = 'quote' | 'versus' | 'stat' | 'tip' | 'feature' | 'screen';
export type SocialTone = 'paper' | 'night' | 'beacon';

export interface SocialCardProps {
  format: SocialFormat;
  /** quote: a real builder's words. versus: what they asked vs what got built. stat: one real figure.
   *  tip: one card of a numbered carousel. feature: one feature as an outcome. screen: a real app moment. */
  kind: SocialKind;
  /** beacon at most once per carousel. */
  tone: SocialTone;
  headline?: string;
  body?: string;
  /** versus */
  asked?: string;
  built?: string;
  status?: Status;
  /** stat */
  figure?: string;
  /** tip: shown as "02 / 05". */
  index?: number;
  count?: number;
  /** Replaces the top-right label. */
  eyebrow?: string;
  /** Bottom right, e.g. the site address. */
  handle?: string;
  /** feature, screen: real components shown close up, at visualZoom. */
  visual?: ReactNode;
  /** Default 2 (1.4 on landscape). */
  visualZoom?: number;
  /** feature, screen: a screenshot instead of visual, cropped to fill. */
  image?: string;
  imageAlt?: string;
  /** CSS object-position for the crop. Default "top center". */
  imagePosition?: string;
  /** Display scale. 1 is true export size; screenshot at 1 to export. */
  scale?: number;
}

export const SOCIAL_FORMATS: Record<SocialFormat, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: 'Instagram · Facebook feed' },
  portrait: { width: 1080, height: 1350, label: 'Instagram · Facebook · LinkedIn feed' },
  story: { width: 1080, height: 1920, label: 'Instagram · Facebook story' },
  landscape: { width: 1200, height: 627, label: 'LinkedIn · Facebook link post' },
};

const pad2 = (n: number) => String(n).padStart(2, '0');

// Drawn at export size and scaled for display. Always the light palette, so
// exports look the same whatever theme the screen is in.
export function SocialCard(props: SocialCardProps) {
  const { format, kind, tone, headline, body, scale = 1 } = props;
  const size = SOCIAL_FORMATS[format];

  let main: ReactNode;
  if (kind === 'versus') {
    main = (
      <div className={styles.versus}>
        <div className={styles.half}>
          <p className={styles.eyebrow}>You asked</p>
          <p className={styles.asked}>{props.asked}</p>
        </div>
        <div className={cx(styles.half, styles.built)}>
          <p className={styles.eyebrow}>It built</p>
          <p className={styles.text}>{props.built}</p>
          {props.status && (
            <span className={cx(styles.status, styles[`status-${props.status}`])}>
              <StatusIcon status={props.status} size={30} />
              {STATUS[props.status].word}
            </span>
          )}
        </div>
      </div>
    );
  } else if (kind === 'feature' || kind === 'screen') {
    const zoom = props.visualZoom ?? (format === 'landscape' ? 1.4 : 2);
    const visual = props.image ? (
      <img
        className={styles.shot}
        src={props.image}
        alt={props.imageAlt ?? ''}
        style={{ objectPosition: props.imagePosition ?? 'top center' }}
      />
    ) : props.visual ? (
      <div className={styles.zoom} style={{ zoom }}>
        {props.visual}
      </div>
    ) : null;
    main = (
      <div className={styles.showcase}>
        <div className={styles.copy}>
          <p className={cx(styles.headline, styles.headlineSm)}>{headline}</p>
          {body && <p className={styles.text}>{body}</p>}
        </div>
        {visual && <div className={cx(styles.window, props.image && styles.windowImage)}>{visual}</div>}
      </div>
    );
  } else if (kind === 'stat') {
    main = (
      <div className={styles.main}>
        <p className={styles.figure}>{props.figure}</p>
        {headline && <p className={cx(styles.headline, styles.headlineSm)}>{headline}</p>}
        {body && <p className={styles.text}>{body}</p>}
      </div>
    );
  } else {
    main = (
      <div className={styles.main}>
        <p className={cx(styles.headline, kind === 'quote' && styles.quote)}>{headline}</p>
        {body && <p className={styles.text}>{body}</p>}
      </div>
    );
  }

  const eyebrow =
    props.eyebrow ??
    (kind === 'tip' && props.index ? `${pad2(props.index)}${props.count ? ` / ${pad2(props.count)}` : ''}` : null);

  const cardStyle: CSSProperties = { width: size.width, height: size.height, transform: `scale(${scale})` };

  return (
    <div className={styles.frame} style={{ width: size.width * scale, height: size.height * scale }}>
      <article
        className={cx('takeoff', styles.card, styles[format], styles[tone], styles[`kind-${kind}`])}
        data-theme="light"
        style={cardStyle}
        aria-label={`${headline || props.asked || props.figure || 'Takeoff'} (${size.label})`}
      >
        <header className={styles.top}>
          <span className={styles.runway} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        </header>
        {main}
        <footer className={styles.foot}>
          <span className={styles.wordmark}>Takeoff</span>
          {props.handle && <span className={styles.handle}>{props.handle}</span>}
        </footer>
      </article>
    </div>
  );
}
