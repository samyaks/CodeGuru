import type { IntakeScript, ProjectStory } from './types';

// Made-up data for the dev-only previews at /design/project and /design/intake.
// Nothing here comes from a real project.

export const SAMPLE_STORY: ProjectStory = {
  name: 'sample/pawpath',
  headline: 'Not ready to go live yet.',
  support:
    'Sign-in and your saved data are in good shape. Who can see what isn’t, and neither is privacy. Those two matter most before real people use it.',
  readAt: '2 hours ago',
  told: [
    'A booking app for dog walkers and the owners who hire them.',
    'People pay for each walk, at launch.',
    'Owners and walkers sign in and see different things.',
    'You’ll keep addresses and phone numbers.',
    'Anyone on the internet can use it from day one.',
  ],
  checks: [
    {
      id: 'permissions',
      label: 'Who sees what',
      need: 'Owners and walkers only see their own bookings.',
      status: 'grounded',
      explanation:
        'Anyone who is signed in can open another person’s booking by changing the number in the address.',
      where: 'Booking page',
      changes: 6,
    },
    {
      id: 'privacy',
      label: 'Privacy',
      need: 'Addresses and phone numbers stay private, and people can ask to have them removed.',
      status: 'grounded',
      explanation:
        'There’s no privacy page, and no way for someone to ask for their details to be deleted.',
      where: 'Account settings',
      changes: 3,
    },
    {
      id: 'payments',
      label: 'Payments',
      need: 'People can pay for a walk when they book it.',
      status: 'holding',
      explanation:
        'Checkout opens, but nothing records the payment once it goes through. A walker could be booked without ever being paid.',
      where: 'Checkout page',
      changes: 4,
    },
    {
      id: 'abuse',
      label: 'Abuse protection',
      need: 'Nobody can flood the app with requests.',
      status: 'holding',
      explanation:
        'Sign-in limits how often someone can try. Booking and search don’t, so one person could slow it down for everyone.',
      changes: 5,
    },
    {
      id: 'email',
      label: 'Email',
      need: 'People get a confirmation email after they book.',
      status: 'holding',
      explanation:
        'The email is written and sends while you test, but no sender address is set for launch. Real emails may land in spam.',
      where: 'Booking confirmation',
      changes: 2,
    },
    {
      id: 'signin',
      label: 'Sign-in',
      need: 'Owners and walkers can sign in and out.',
      status: 'cleared',
      explanation: 'Sign-in, sign-out and password reset all work.',
      changes: 8,
    },
    {
      id: 'data',
      label: 'Saved data',
      need: 'Bookings are saved and are still there after a restart.',
      status: 'cleared',
      explanation: 'Bookings are stored in a database and a restart keeps them.',
      changes: 5,
    },
    {
      id: 'live',
      label: 'Going live',
      need: 'The app has a place to run, and something that tells us when it’s down.',
      status: 'cleared',
      explanation: 'It has a place to run and a health check.',
      changes: 3,
    },
    {
      id: 'secrets',
      label: 'Secret keys',
      need: 'Passwords and keys aren’t visible to anyone who looks at the code.',
      status: 'cleared',
      explanation: 'No keys or passwords were found in your code.',
      changes: 9,
    },
    {
      id: 'tests',
      label: 'Tests',
      need: 'The booking steps are covered by tests.',
      status: 'cleared',
      explanation: 'Booking, cancelling and rescheduling each have a test.',
      changes: 4,
    },
  ],
  shipped: [
    {
      id: 's1',
      summary: 'Owners can now reschedule a booking from the booking page.',
      when: 'Yesterday',
      status: 'cleared',
      where: 'Booking page',
    },
    {
      id: 's2',
      summary: 'Owners get a message when a walk ends. It doesn’t say which dog.',
      when: '2 days ago',
      status: 'holding',
      where: 'Walk finished message',
    },
    {
      id: 's3',
      summary: 'Walkers can set the days they’re free.',
      when: '3 days ago',
      status: 'cleared',
      where: 'Walker profile',
    },
    {
      id: 's4',
      summary: 'Search now lists walkers by distance, but ignores the area an owner typed in.',
      when: 'Last week',
      status: 'grounded',
      where: 'Search page',
    },
  ],
};

export const SAMPLE_STORY_CLEARED: ProjectStory = {
  ...SAMPLE_STORY,
  headline: 'Ready to go live.',
  support:
    'Every check matches what you told us. Keep this page open when you change something, and it will tell you if that stops being true.',
  checks: SAMPLE_STORY.checks.map((c) =>
    c.status === 'cleared'
      ? c
      : { ...c, status: 'cleared', explanation: 'This now matches what you told us.' },
  ),
  shipped: SAMPLE_STORY.shipped.map((s) => ({ ...s, status: 'cleared' })),
};

export const SAMPLE_INTAKE: IntakeScript = {
  draft:
    'A booking app for dog walkers and the owners who hire them. Owners find a walker, book a time and pay. Walkers set when they’re free and see who they’re walking.',
  alreadyFound: [
    { label: 'Saved data', status: 'cleared', note: 'Bookings are kept in a database.' },
    { label: 'Sign-in', status: 'cleared', note: 'People can sign in, sign out and reset a password.' },
  ],
  questions: [
    {
      id: 'payments',
      topic: 'Payments',
      ask: 'Will people pay you at launch?',
      because: 'Stripe is in your project, but I can’t see anything recording a payment.',
      choices: [
        { id: 'launch', label: 'Yes, at launch' },
        { id: 'later', label: 'Yes, but later', meaning: 'I’ll check the basics now and the rest when you’re closer.' },
        { id: 'free', label: 'No, it’s free', skips: true, meaning: 'I won’t look for payments.' },
        { id: 'unsure', label: 'Not sure', unsure: true, meaning: 'I’ll check anyway. You can decide later.' },
      ],
      finding: {
        label: 'Payments',
        status: 'holding',
        note: 'Checkout opens, but nothing records the payment afterwards.',
      },
    },
    {
      id: 'roles',
      topic: 'Who sees what',
      ask: 'Will different people see different things?',
      because: 'You have owners and walkers.',
      choices: [
        { id: 'yes', label: 'Yes, owners and walkers differ' },
        { id: 'no', label: 'No, everyone sees the same', skips: true, meaning: 'I won’t check who can open what.' },
        { id: 'unsure', label: 'Not sure', unsure: true, meaning: 'I’ll check anyway. You can decide later.' },
      ],
      finding: {
        label: 'Who sees what',
        status: 'grounded',
        note: 'Anyone signed in can open another person’s booking.',
      },
    },
    {
      id: 'personal',
      topic: 'Privacy',
      ask: 'Will you keep people’s addresses or phone numbers?',
      because: 'Your booking form asks for both.',
      choices: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No', skips: true, meaning: 'I won’t look for privacy basics.' },
        { id: 'unsure', label: 'Not sure', unsure: true, meaning: 'I’ll check anyway. You can decide later.' },
      ],
      finding: {
        label: 'Privacy',
        status: 'grounded',
        note: 'No privacy page, and no way to ask for details to be removed.',
      },
    },
    {
      id: 'email',
      topic: 'Email',
      ask: 'Should people get an email after they book?',
      choices: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No', skips: true, meaning: 'I won’t check email.' },
        { id: 'unsure', label: 'Not sure', unsure: true, meaning: 'I’ll check anyway. You can decide later.' },
      ],
      finding: {
        label: 'Email',
        status: 'holding',
        note: 'The email is written, but no sender address is set for launch.',
      },
    },
    {
      id: 'audience',
      topic: 'Abuse protection',
      ask: 'Who will use it at launch: a few friends, or anyone?',
      choices: [
        { id: 'anyone', label: 'Anyone on the internet' },
        { id: 'friends', label: 'A few friends', skips: true, meaning: 'I’ll skip the checks that matter once strangers arrive.' },
        { id: 'unsure', label: 'Not sure', unsure: true, meaning: 'I’ll check anyway. You can decide later.' },
      ],
      finding: {
        label: 'Abuse protection',
        status: 'holding',
        note: 'Booking and search have no limit on how often someone can use them.',
      },
    },
  ],
};
