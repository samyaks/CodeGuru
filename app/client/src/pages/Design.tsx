import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, StatusMark, IntentCard, ConformanceRing, ChangeNote, VerdictPanel,
  PlanInput, Roadmap, SocialCard, STATUSES,
} from '../components/takeoff';
import type { RoadmapStage } from '../components/takeoff';
import styles from './Design.module.css';

// Dev-only review page for the Takeoff design system: every component in
// every state, in either theme. Mounted at /design only when
// import.meta.env.DEV, so it never ships. ?theme=light|dark picks a theme.

type Theme = 'system' | 'light' | 'dark';
const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const COLOR_GROUPS: { name: string; tokens: string[] }[] = [
  { name: 'Surfaces', tokens: ['paper', 'paper-raised', 'paper-sunk'] },
  { name: 'Text and lines', tokens: ['ink', 'ink-muted', 'line', 'line-strong'] },
  { name: 'Brand', tokens: ['beacon', 'beacon-soft', 'on-beacon'] },
  { name: 'Names', tokens: ['title-accent'] },
  { name: 'Verdict panel', tokens: ['night', 'on-night', 'night-muted', 'line-night'] },
  {
    name: 'Status',
    tokens: [
      'cleared', 'cleared-soft', 'cleared-glow',
      'holding', 'holding-soft', 'holding-glow',
      'grounded', 'grounded-soft', 'grounded-glow',
    ],
  },
];

const TYPE_STYLES: { name: string; spec: string; sample: string }[] = [
  { name: 'display', spec: 'Serif 56 / 60, 300', sample: 'Build what you meant.' },
  { name: 'title', spec: 'Serif 32 / 38, 400', sample: 'Your flight plan' },
  { name: 'intent', spec: 'Serif 20 / 30, 400', sample: 'Customers can pay with a saved card.' },
  { name: 'numeral', spec: 'Serif 40 / 44, 300, tabular', sample: '5 of 6' },
  { name: 'heading', spec: 'Sans 17 / 24, 600', sample: 'What changed' },
  { name: 'body', spec: 'Sans 15 / 24, 400', sample: 'The checkout now remembers cards, but only for signed-in customers.' },
  { name: 'small', spec: 'Sans 13 / 18, 400', sample: 'Checked against 3 changes' },
  { name: 'eyebrow', spec: 'Sans 11 / 16, 600, 0.16em, capitals', sample: 'Verdict' },
  { name: 'button', spec: 'Sans 14 / 20, 600, 0.02em', sample: 'Approve and go live' },
  { name: 'code', spec: 'Mono 13 / 20, 400', sample: 'if (customer.signedIn) showSavedCards(customer)' },
];

const SAVED_CARD_CODE = `if (customer.signedIn) {
  showSavedCards(customer);
}`;

const REFUND_CODE = `refund.method = 'store_credit';
refund.amount = order.total;`;

const ROADMAP_STAGES: RoadmapStage[] = [
  {
    kind: 'live',
    when: 'Out now',
    items: [
      { title: 'Customers get an email receipt after they pay.', status: 'cleared' },
      { title: 'Customers can pay with a saved card.', note: 'Guests are not offered it yet', status: 'holding' },
    ],
  },
  {
    kind: 'now',
    when: 'This month',
    items: [{ title: 'Refunds go back to the card that paid.', status: 'grounded' }],
  },
  {
    kind: 'next',
    when: 'After launch',
    items: [
      { title: 'Anyone can book a table without an account.', note: 'For first-time visitors' },
      { title: 'Regulars see their usual order first.' },
    ],
  },
  { kind: 'later', items: [] },
];

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id} className="type-title">{title}</h2>
        {note && <p className={`type-body ${styles.muted}`}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.state}>
      <p className={`type-small ${styles.muted}`}>{label}</p>
      {children}
    </div>
  );
}

function initialTheme(): Theme {
  const t = new URLSearchParams(window.location.search).get('theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export default function Design() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [plan, setPlan] = useState(
    'Customers can pay with a saved card.\nCustomers get an email receipt after they pay.\nRefunds go back to the card that paid.',
  );

  return (
    <div className={`takeoff ${styles.page}`} data-theme={theme === 'system' ? undefined : theme}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.wordmark}>Takeoff</p>
          <h1 className="type-display">Design system</h1>
          <p className={`type-body ${styles.muted} ${styles.lede}`}>
            Every component in every state. This page only exists in development. Rules are in
            app/client/CLAUDE.md. Moved screens, with sample data:{' '}
            <Link to="/design/dashboard" className={styles.link}>Dashboard</Link>.
          </p>
          <div className={styles.themes} role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <label key={t.value} className={styles.themeOption}>
                <input
                  type="radio"
                  name="theme"
                  value={t.value}
                  checked={theme === t.value}
                  onChange={() => setTheme(t.value)}
                />
                <span className="type-button">{t.label}</span>
              </label>
            ))}
          </div>
        </header>

        <Section id="colour" title="Colour" note="Tokens from styles/tokens.css, in the current theme.">
          {COLOR_GROUPS.map((group) => (
            <div key={group.name} className={styles.state}>
              <p className={`type-eyebrow ${styles.muted}`}>{group.name}</p>
              <div className={styles.swatches}>
                {group.tokens.map((token) => (
                  <div key={token} className={styles.swatch}>
                    <div className={styles.swatchChip} style={{ background: `var(--${token})` }} />
                    <span className="type-small">{token}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section id="type" title="Type" note="Serif for the person's words, sans for Takeoff's, mono for code.">
          <div className={styles.typeList}>
            {TYPE_STYLES.map((t) => (
              <div key={t.name} className={styles.typeRow}>
                <p className={`type-small ${styles.muted}`}>
                  <strong>{t.name}</strong> · {t.spec}
                </p>
                <p className={`type-${t.name}`}>{t.sample}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="button" title="Button" note="One primary per view. Quiet for everything else. Night only inside a VerdictPanel.">
          <div className={styles.row}>
            <State label="Primary">
              <Button variant="primary">Check my plan</Button>
            </State>
            <State label="Primary, small">
              <Button variant="primary" size="sm">Check my plan</Button>
            </State>
            <State label="Primary, disabled">
              <Button variant="primary" disabled>Check my plan</Button>
            </State>
            <State label="Quiet">
              <Button variant="quiet">See what changed</Button>
            </State>
            <State label="Quiet, small">
              <Button variant="quiet" size="sm">See what changed</Button>
            </State>
            <State label="Quiet, disabled">
              <Button variant="quiet" disabled>See what changed</Button>
            </State>
          </div>
          <div className={styles.row}>
            <State label="Night, on the night surface">
              <div className={styles.nightWell}>
                <Button variant="night">Approve anyway</Button>
                <Button variant="night" size="sm">Approve anyway</Button>
              </div>
            </State>
          </div>
          <div className={styles.narrow}>
            <State label="Quiet, wide">
              <Button variant="quiet" wide>See what changed</Button>
            </State>
          </div>
        </Section>

        <Section id="status" title="StatusMark" note="Always the word and the icon. Show the hint on first use in a screen.">
          <div className={styles.row}>
            {STATUSES.map((s) => (
              <StatusMark key={s} status={s} />
            ))}
          </div>
          <div className={styles.stack}>
            {STATUSES.map((s) => (
              <StatusMark key={s} status={s} showHint />
            ))}
            <State label="Custom hint">
              <StatusMark status="holding" showHint hint="Works for signed-in customers only" />
            </State>
          </div>
        </Section>

        <Section id="intent" title="IntentCard" note="The person's words verbatim in the serif, Takeoff's explanation under it.">
          <div className={styles.column}>
            <IntentCard
              index={1}
              status="cleared"
              intent="Customers get an email receipt after they pay."
              explanation="A receipt goes out as soon as payment goes through, with the items and the total."
              changes={2}
            />
            <IntentCard
              index={2}
              status="holding"
              intent="Customers can pay with a saved card."
              explanation="Signed-in customers can save a card and use it again. Guests are not offered the option."
              changes={3}
            />
            <IntentCard
              index={3}
              status="grounded"
              intent="Refunds go back to the card that paid."
              explanation="Refunds are given as store credit instead of going back to the card."
              changes={1}
            />
            <State label="No number, explanation or change count">
              <IntentCard status="holding" intent="Anyone can book a table without an account, and get a reminder the day before." />
            </State>
          </div>
        </Section>

        <Section id="ring" title="ConformanceRing" note="Beacon arc on a sunk track, filling on load. Under 96px it becomes text.">
          <div className={styles.row}>
            <State label="5 of 6, default size">
              <ConformanceRing cleared={5} total={6} />
            </State>
            <State label="None cleared">
              <ConformanceRing cleared={0} total={6} size={160} />
            </State>
            <State label="All cleared">
              <ConformanceRing cleared={6} total={6} size={160} />
            </State>
            <State label="Long count, 120px">
              <ConformanceRing cleared={12} total={12} size={120} strokeWidth={10} />
            </State>
            <State label="Custom label">
              <ConformanceRing cleared={3} total={4} size={160} label="Intents cleared this week" />
            </State>
            <State label="80px, shown as text">
              <ConformanceRing cleared={3} total={4} size={80} />
            </State>
          </div>
        </Section>

        <Section id="change" title="ChangeNote" note="A plain sentence first. The code stays behind “Show the code”.">
          <div className={styles.column}>
            <ChangeNote
              status="holding"
              summary="Saved cards now appear at checkout, but only for signed-in customers."
              where="Checkout page"
              code={SAVED_CARD_CODE}
            />
            <State label="Code open by default, for a Grounded result">
              <ChangeNote
                status="grounded"
                summary="Refunds are issued as store credit instead of going back to the card."
                where="Refunds, in the order history"
                code={REFUND_CODE}
                defaultOpen
              />
            </State>
            <State label="No code">
              <ChangeNote status="cleared" summary="The receipt email now lists each item and the total." where="Receipt email" />
            </State>
            <State label="Summary only">
              <ChangeNote summary="The order summary now shows each item's size." />
            </State>
          </div>
        </Section>

        <Section id="verdict" title="VerdictPanel" note="The one dark block on the page. At most two actions.">
          <div className={styles.row}>
            <VerdictPanel
              status="cleared"
              summary="Everything in your plan matches what got built."
              counts={{ cleared: 6, holding: 0, grounded: 0 }}
            >
              <Button variant="primary" wide>Approve and go live</Button>
              <Button variant="night" wide>See what changed</Button>
            </VerdictPanel>
            <VerdictPanel
              status="holding"
              summary="Two intents only partly match. Take a look before this goes live."
              counts={{ cleared: 4, holding: 2, grounded: 0 }}
            >
              <Button variant="night" wide>See what needs a look</Button>
            </VerdictPanel>
            <VerdictPanel status="grounded" eyebrow="Last check" summary="Refunds don't match your plan." />
          </div>
        </Section>

        <Section id="plan" title="PlanInput" note="The person's words in the serif. One intent per line; never a format.">
          <div className={styles.column}>
            <PlanInput
              placeholder="Customers can pay with a saved card."
              hint="Write one thing you want per line, in your own words."
            />
            <State label="Filled">
              <PlanInput label="Your flight plan" rows={5} value={plan} onChange={(e) => setPlan(e.target.value)} />
            </State>
          </div>
        </Section>

        <Section id="roadmap" title="Roadmap" note="All four stages, in order. Only Live and Now items carry a status.">
          <Roadmap title="What you're building" stages={ROADMAP_STAGES} />
        </Section>

        <Section
          id="social"
          title="SocialCard"
          note="Marketing only. Drawn at export size, shown here scaled down, always in the light palette. Sample copy; real quotes and figures only before posting."
        >
          <div className={styles.row}>
            <State label="Square, versus, paper">
              <SocialCard
                format="square"
                kind="versus"
                tone="paper"
                asked="Customers can pay with a saved card."
                built="Signed-in customers can. Guests are not offered the option."
                status="holding"
                scale={0.3}
              />
            </State>
            <State label="Square, quote, night">
              <SocialCard
                format="square"
                kind="quote"
                tone="night"
                headline="Sample quote. Replace with a real builder's words."
                scale={0.3}
              />
            </State>
            <State label="Square, stat, beacon">
              <SocialCard
                format="square"
                kind="stat"
                tone="beacon"
                figure="5 of 6"
                headline="Sample figure. Use only numbers you can stand behind."
                scale={0.3}
              />
            </State>
            <State label="Portrait, tip, paper">
              <SocialCard
                format="portrait"
                kind="tip"
                tone="paper"
                index={2}
                count={5}
                headline="Write your plan the way you'd explain it to a friend."
                body="One thing per line. Takeoff checks each one."
                scale={0.3}
              />
            </State>
            <State label="Portrait, feature, paper">
              <SocialCard
                format="portrait"
                kind="feature"
                tone="paper"
                eyebrow="Plain-English checks"
                headline="Know when the AI built something you didn't ask for."
                visual={
                  <div className={styles.socialVisual}>
                    <IntentCard
                      index={2}
                      status="holding"
                      intent="Customers can pay with a saved card."
                      explanation="Guests are not offered the option."
                      changes={3}
                    />
                  </div>
                }
                scale={0.3}
              />
            </State>
            <State label="Story, versus, night">
              <SocialCard
                format="story"
                kind="versus"
                tone="night"
                asked="Refunds go back to the card that paid."
                built="Refunds are given as store credit."
                status="grounded"
                scale={0.2}
              />
            </State>
            <State label="Landscape, screen, night">
              <SocialCard
                format="landscape"
                kind="screen"
                tone="night"
                headline="Every change, checked against your plan."
                visual={
                  <div className={styles.socialVisualNarrow}>
                    <ChangeNote
                      status="cleared"
                      summary="The receipt email now lists each item and the total."
                      where="Receipt email"
                    />
                  </div>
                }
                scale={0.3}
              />
            </State>
            <State label="Landscape, stat, paper">
              <SocialCard
                format="landscape"
                kind="stat"
                tone="paper"
                figure="3 of 4"
                headline="Sample figure. Use only numbers you can stand behind."
                handle="takeoff.example"
                scale={0.3}
              />
            </State>
          </div>
        </Section>
      </div>
    </div>
  );
}
