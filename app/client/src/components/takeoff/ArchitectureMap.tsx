import { StatusIcon } from './StatusIcon';
import { STATUS, cx, type Status } from './status';
import styles from './ArchitectureMap.module.css';

export interface ArchitectureNode {
  id: string;
  label: string;
  status: Status;
}

export interface ArchitectureMapProps {
  /** The app in the middle: its name, as the person knows it. */
  name: string;
  nodes: ArchitectureNode[];
  /** Makes every node that isn't cleared a button. */
  onSelect?: (id: string) => void;
}

// Where each check sits around the app. Anything not listed goes on the right.
const SIDE: Record<string, 'in' | 'out'> = {
  signin: 'in',
  permissions: 'in',
  abuse: 'in',
  privacy: 'in',
};

const W = 760;
const NODE_W = 244;
const NODE_H = 48;
const GAP = 12;
const TOP = 36;
const HUB_W = 176;
const HUB_H = 88;

const LEFT_X = 0;
const RIGHT_X = W - NODE_W;
const HUB_X = (W - HUB_W) / 2;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function edge(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}

export function ArchitectureMap({ name, nodes, onSelect }: ArchitectureMapProps) {
  const left = nodes.filter((n) => SIDE[n.id] === 'in');
  const right = nodes.filter((n) => SIDE[n.id] !== 'in');
  const rows = Math.max(left.length, right.length, 1);
  const colH = rows * NODE_H + (rows - 1) * GAP;
  const H = TOP + colH;
  const hubY = TOP + (colH - HUB_H) / 2;
  const hubMid = hubY + HUB_H / 2;

  const place = (list: ArchitectureNode[]) => {
    const h = list.length * NODE_H + Math.max(0, list.length - 1) * GAP;
    const start = TOP + (colH - h) / 2;
    return list.map((n, i) => ({ node: n, y: start + i * (NODE_H + GAP) }));
  };
  const placedLeft = place(left);
  const placedRight = place(right);

  const cleared = nodes.filter((n) => n.status === 'cleared').length;
  const spoken = `${name}, ${cleared} of ${nodes.length} launch checks cleared.`;

  const renderNode = (n: ArchitectureNode, x: number, y: number) => {
    const interactive = Boolean(onSelect) && n.status !== 'cleared';
    const props = interactive
      ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': `${n.label}, ${STATUS[n.status].word}. Jump to it.`,
          onClick: () => onSelect?.(n.id),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect?.(n.id);
            }
          },
        }
      : {};
    return (
      <g
        key={n.id}
        className={cx(styles.node, styles[n.status], interactive && styles.interactive)}
        transform={`translate(${x} ${y})`}
        {...(interactive ? props : { role: 'img' as const, 'aria-label': `${n.label}, ${STATUS[n.status].word}` })}
      >
        <rect className={styles.card} width={NODE_W} height={NODE_H} rx={12} />
        <g className={styles.icon} transform="translate(14 16)">
          <foreignObject width="16" height="16" aria-hidden="true">
            <StatusIcon status={n.status} />
          </foreignObject>
        </g>
        <text className={styles.label} x={40} y={21}>{clip(n.label, 28)}</text>
        <text className={styles.word} x={40} y={37}>{STATUS[n.status].word}</text>
      </g>
    );
  };

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={spoken}
      >
        <text className={styles.eyebrow} x={LEFT_X} y={14}>Who gets in</text>
        <text className={styles.eyebrow} x={W} y={14} textAnchor="end">What it runs on</text>

        <g aria-hidden="true">
          {placedLeft.map(({ node, y }) => (
            <path
              key={node.id}
              className={cx(styles.edge, styles[node.status])}
              d={edge(LEFT_X + NODE_W, y + NODE_H / 2, HUB_X, hubMid)}
            />
          ))}
          {placedRight.map(({ node, y }) => (
            <path
              key={node.id}
              className={cx(styles.edge, styles[node.status])}
              d={edge(HUB_X + HUB_W, hubMid, RIGHT_X, y + NODE_H / 2)}
            />
          ))}
        </g>

        <g transform={`translate(${HUB_X} ${hubY})`} aria-hidden="true">
          <rect className={styles.hub} width={HUB_W} height={HUB_H} rx={20} />
          <text className={styles.hubName} x={HUB_W / 2} y={38} textAnchor="middle">{clip(name, 16)}</text>
          <text className={styles.hubCount} x={HUB_W / 2} y={62} textAnchor="middle">
            {cleared} of {nodes.length} cleared
          </text>
        </g>

        {placedLeft.map(({ node, y }) => renderNode(node, LEFT_X, y))}
        {placedRight.map(({ node, y }) => renderNode(node, RIGHT_X, y))}
      </svg>
    </div>
  );
}
