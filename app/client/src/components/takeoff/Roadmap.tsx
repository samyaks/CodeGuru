import { StatusMark } from './StatusMark';
import { cx, type Status } from './status';
import styles from './Roadmap.module.css';

export type RoadmapStageKind = 'live' | 'now' | 'next' | 'later';

export interface RoadmapItem {
  /** The intent or feature, in the person's own words. */
  title: string;
  /** One short line: who it's for, or why it's here. */
  note?: string;
  /** Only Live and Now items show one: only built things can be checked. */
  status?: Status;
}

export interface RoadmapStage {
  kind: RoadmapStageKind;
  /** Defaults to Live, Now, Next or Later. */
  name?: string;
  /** A time hint in plain words ("This month", "After launch"). */
  when?: string;
  items: RoadmapItem[];
}

export interface RoadmapProps {
  stages: RoadmapStage[];
  title?: string;
  eyebrow?: string;
}

const ORDER: RoadmapStageKind[] = ['live', 'now', 'next', 'later'];
const NAMES: Record<RoadmapStageKind, string> = { live: 'Live', now: 'Now', next: 'Next', later: 'Later' };

export function Roadmap({ stages, title, eyebrow = 'Roadmap' }: RoadmapProps) {
  // Always all four stages, in order, even when one is empty.
  const columns = ORDER.map(
    (kind) => stages.find((s) => s.kind === kind) ?? { kind, items: [] as RoadmapItem[] },
  );
  return (
    <section className={styles.roadmap} aria-label={title ?? eyebrow}>
      {title && (
        <div className={styles.head}>
          <p className={cx('type-eyebrow', styles.eyebrow)}>{eyebrow}</p>
          <h2 className={cx('type-title', styles.title)}>{title}</h2>
        </div>
      )}
      <ol className={styles.stages}>
        {columns.map((stage) => {
          const built = stage.kind === 'live' || stage.kind === 'now';
          return (
            <li key={stage.kind} className={cx(styles.stage, styles[stage.kind])}>
              <div className={styles.mark} aria-hidden="true">
                <span className={styles.dot} />
              </div>
              <div className={styles.body}>
                <div className={styles.stageHead}>
                  <span className={cx('type-eyebrow', styles.stageName)}>{stage.name ?? NAMES[stage.kind]}</span>
                  {stage.when && <span className={cx('type-small', styles.muted)}>{stage.when}</span>}
                  <span className={cx('type-small', styles.muted, styles.count)}>{stage.items.length}</span>
                </div>
                <ul className={styles.items}>
                  {stage.items.map((item, i) => (
                    <li key={i} className={styles.item}>
                      <p className={styles.itemTitle}>{item.title}</p>
                      {item.note && <p className={cx('type-small', styles.muted, styles.note)}>{item.note}</p>}
                      {built && item.status && (
                        <div>
                          <StatusMark status={item.status} />
                        </div>
                      )}
                    </li>
                  ))}
                  {stage.items.length === 0 && (
                    <li className={cx('type-small', styles.muted, styles.empty)}>Nothing here yet</li>
                  )}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
