'use strict';

// Async agreements (Milestone 3). Any member proposes; every current member
// agrees or says "Not yet" (with a comment). When everyone has agreed the
// agreement is accepted and committed into takeoff.yaml. If it sits for 48
// hours with no "Not yet", the area's Creators (or, with no area, anyone with
// write access to the repo) can decide alone, and that is recorded.
//
// Committing is a committing action (services/team/committing.js): a member
// without write access who triggers it leaves a recommendation that anyone
// with write access confirms.

const crypto = require('crypto');
const { agreementId: makeAgreementId } = require('@takeoff/cli');
const { AppError } = require('../../lib/app-error');
const committing = require('../team/committing');
const { ensureOwnerMember } = require('../team/members');
const { displayName } = require('../team/identity');
const { readIntent, forgetIntent } = require('./intent');
const { commitAgreement, defaultWriteClient } = require('./commit');
const notify = require('./notify');

const STALL_MS = 48 * 60 * 60 * 1000;
const MAX_TEXT = 1000;
const MAX_COMMENT = 500;
const COMMIT_ACTION = 'agreement.commit';

let emailOn;
function defaultDeps() {
  const db = require('../../lib/db');
  if (emailOn === undefined) emailOn = !!notify.transportFromEnv();
  return {
    agreements: db.agreements,
    agreementVotes: db.agreementVotes,
    projectMembers: db.projectMembers,
    userGithubLinks: db.userGithubLinks,
    notificationOutbox: db.notificationOutbox,
    deployments: db.deployments,
    emailEnabled: emailOn,
    readIntent: (project) => readIntent(project),
    writeClientFor: defaultWriteClient,
    committing: undefined, // committing.js defaults
    onCommitted: async (projectId) => forgetIntent(projectId),
    appUrl: require('../team/members').appUrlFromEnv(),
    now: () => new Date(),
    random: () => crypto.randomBytes(3).toString('hex'),
  };
}

const isOwner = (project, user) => !!(user?.id && project.user_id && project.user_id === user.id);
const confirmedEmail = (user) => (user?.email && user?.email_confirmed_at ? String(user.email).toLowerCase() : null);

/** Everyone on the project now, owner included: [{ userId, name, email }]. */
async function currentMembers(project, deps) {
  const rows = await deps.projectMembers.list(project.id);
  const out = rows.map((r) => ({ userId: r.user_id, name: r.display_name || null, email: r.email ? String(r.email).toLowerCase() : null }));
  if (project.user_id && !out.some((m) => m.userId === project.user_id)) out.unshift({ userId: project.user_id, name: null, email: null });
  return out;
}

async function assertMember(project, user, deps) {
  if (!user?.id) throw AppError.unauthorized('Sign in to see this project.');
  if (isOwner(project, user)) {
    await ensureOwnerMember(project, user, { projectMembers: deps.projectMembers });
    return;
  }
  if (!(await deps.projectMembers.get(project.id, user.id))) throw AppError.forbidden('Forbidden');
}

function isStalled(agreement, votes, now) {
  return agreement.status === 'proposed'
    && now.getTime() - new Date(agreement.proposed_at).getTime() >= STALL_MS
    && !votes.some((v) => v.vote === 'not_yet');
}

/** Whether `user` may decide a stalled agreement alone, and why not. */
async function decideRight(project, agreement, user, intent, deps) {
  if (agreement.area_id) {
    const area = intent.areas.find((a) => a.id === agreement.area_id);
    if (!area) return { canDecide: false, reason: intent.ok ? 'area_gone' : (intent.reason || 'intent_unavailable') };
    const email = confirmedEmail(user);
    if (!area.creators.length) return { canDecide: false, reason: 'area_has_no_creators' };
    return email && area.creators.includes(email) ? { canDecide: true, reason: null } : { canDecide: false, reason: 'not_area_creator' };
  }
  try {
    const access = await committing.writeAccess(project, user, writeDeps(deps));
    return access.canWrite ? { canDecide: true, reason: null } : { canDecide: false, reason: access.reason || 'no_write_access' };
  } catch (err) {
    console.warn('[agreements] write access check failed:', err.message);
    return { canDecide: false, reason: 'github_check_failed' };
  }
}

function writeDeps(deps) {
  if (deps.committing) return deps.committing;
  const db = require('../../lib/db');
  const { getGithubApp } = require('../../lib/github-app');
  return {
    recommendations: db.recommendations,
    userGithubLinks: deps.userGithubLinks,
    clientForInstallation: (id, repo) => getGithubApp().clientForInstallation(id, { repo }),
    newId: () => crypto.randomUUID(),
  };
}

function publicAgreement(a, { votes, members, user, intent, now, decide }) {
  const nameOf = (id) => members.find((m) => m.userId === id)?.name || null;
  const mine = votes.find((v) => v.user_id === user.id);
  const agreed = new Set(votes.filter((v) => v.vote === 'agree').map((v) => v.user_id));
  const area = a.area_id ? intent.areas.find((x) => x.id === a.area_id) : null;
  return {
    id: a.id,
    text: a.text,
    areaId: a.area_id || null,
    areaName: area?.name || null,
    source: a.source || null,
    status: a.status,
    proposedBy: { userId: a.proposed_by, name: a.proposed_by_name || nameOf(a.proposed_by) },
    proposedAt: a.proposed_at,
    decidedBy: a.decided_by ? { userId: a.decided_by, name: nameOf(a.decided_by) } : null,
    decidedAt: a.decided_at || null,
    decidedVia: a.decided_via || null,
    decisionNote: a.decision_note || null,
    votes: votes.map((v) => ({ userId: v.user_id, name: nameOf(v.user_id), vote: v.vote, comment: v.comment || null, votedAt: v.voted_at })),
    waitingOn: a.status === 'proposed' ? members.filter((m) => !agreed.has(m.userId)).map((m) => ({ userId: m.userId, name: m.name })) : [],
    stalled: isStalled(a, votes, now),
    stallAt: a.status === 'proposed' ? new Date(new Date(a.proposed_at).getTime() + STALL_MS).toISOString() : null,
    you: {
      vote: mine?.vote || null,
      comment: mine?.comment || null,
      canVote: a.status === 'proposed',
      canWithdraw: a.status === 'proposed' && a.proposed_by === user.id,
      canDecide: !!decide?.canDecide,
      decideReason: decide?.reason || null,
      canRetryCommit: a.status === 'accepted' && ['failed', 'none'].includes(a.commit_state),
    },
    commit: {
      state: a.commit_state,
      sha: a.commit_sha || null,
      url: a.commit_url || null,
      prUrl: a.commit_pr_url || null,
      error: a.commit_error || null,
      recommendationId: a.recommendation_id || null,
    },
  };
}

const projectLink = (project, deps) => `${deps.appUrl}/read/${encodeURIComponent(project.id)}`;
const quote = (text) => (text.length > 140 ? `${text.slice(0, 139)}…` : text);

async function notifyMembers(project, kind, agreement, { except = null, to = null, subject, body }, deps) {
  try {
    const members = to || (await currentMembers(project, deps)).filter((m) => m.userId !== except);
    await notify.enqueue({ projectId: project.id, recipients: members, kind, subject, body, link: projectLink(project, deps) }, deps);
  } catch (err) {
    console.warn('[agreements] queueing email failed:', err.message);
  }
}

/**
 * Commit an accepted agreement, or leave a recommendation when `user` can't
 * write to the repo. Never throws: the outcome is on the agreement row.
 */
async function startCommit(project, agreement, user, deps) {
  try {
    const out = await committing.performCommittingAction(
      { project, user, type: COMMIT_ACTION, payload: { agreementId: agreement.id } },
      writeDeps(deps),
    );
    if (out.status === 'recommended') {
      await deps.agreements.setCommit(agreement.id, { state: 'waiting_for_write', recommendationId: out.recommendation?.id || null });
    }
  } catch (err) {
    console.warn(`[agreements] commit of ${agreement.id} failed:`, err.message);
  }
}

/** Accept `agreement` if every current member has agreed. */
async function acceptIfEveryoneAgreed(project, agreement, user, deps) {
  if (agreement.status !== 'proposed') return agreement;
  const [members, votes] = await Promise.all([currentMembers(project, deps), deps.agreementVotes.listFor([agreement.id])]);
  const agreed = new Set(votes.filter((v) => v.vote === 'agree').map((v) => v.user_id));
  if (!members.length || !members.every((m) => agreed.has(m.userId))) return agreement;
  const emails = members.map((m) => m.email || (m.userId === user.id ? confirmedEmail(user) : null)).filter(Boolean);
  const accepted = await deps.agreements.decide(project.id, agreement.id, {
    status: 'accepted', decidedBy: user.id, via: 'everyone_agreed', agreedByEmails: [...new Set(emails)],
  });
  if (!accepted) return (await deps.agreements.get(project.id, agreement.id)) || agreement;
  await notifyMembers(project, 'agreement_accepted', accepted, {
    subject: `Agreed: ${quote(accepted.text)}`,
    body: `Everyone on ${project.repo || 'your project'} agreed to:\n\n"${accepted.text}"\n\nTakeoff is adding it to takeoff.yaml.`,
  }, deps);
  await startCommit(project, accepted, user, deps);
  return (await deps.agreements.get(project.id, agreement.id)) || accepted;
}

async function loadAgreement(project, id, deps) {
  const a = typeof id === 'string' ? await deps.agreements.get(project.id, id) : null;
  if (!a) throw AppError.notFound('Agreement not found');
  return a;
}

async function view(project, rows, user, deps) {
  const [members, votes, intent] = await Promise.all([
    currentMembers(project, deps),
    deps.agreementVotes.listFor(rows.map((r) => r.id)),
    deps.readIntent(project),
  ]);
  const now = deps.now();
  const out = [];
  for (const a of rows) {
    const v = votes.filter((x) => x.agreement_id === a.id);
    const decide = isStalled(a, v, now) ? await decideRight(project, a, user, intent, deps) : null;
    out.push(publicAgreement(a, { votes: v, members, user, intent, now, decide }));
  }
  return { agreements: out, intent };
}

// ── Public operations ──────────────────────────────────────────────────

async function listAgreements({ project, user }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  let rows = await deps.agreements.list(project.id);
  // Someone leaving can complete a proposal: settle those now.
  const settled = [];
  for (const a of rows) settled.push(a.status === 'proposed' ? await acceptIfEveryoneAgreed(project, a, user, deps) : a);
  rows = settled;
  const { agreements, intent } = await view(project, rows, user, deps);
  return {
    agreements,
    areas: intent.areas.map((a) => ({ id: a.id, name: a.name })),
    intent: { ok: intent.ok, reason: intent.reason, branch: intent.branch },
    emailsOn: !!deps.emailEnabled,
  };
}

function cleanSource(source) {
  if (source === undefined || source === null || source === '') return null;
  const s = String(source).trim();
  let ok = false;
  try { ok = /^https?:$/.test(new URL(s).protocol); } catch { /* not a URL */ }
  if (!ok || s.length > 500) throw AppError.badRequest('The link must be an http(s) address.');
  return s;
}

async function propose({ project, user, body = {} }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw AppError.badRequest('Say what the team is agreeing to.');
  if (text.length > MAX_TEXT) throw AppError.badRequest(`Keep it under ${MAX_TEXT} characters.`);
  const source = cleanSource(body.source);
  let areaId = null;
  if (body.areaId) {
    const intent = await deps.readIntent(project);
    const area = intent.areas.find((a) => a.id === body.areaId);
    if (!area) throw AppError.badRequest(intent.ok ? 'That area is not in takeoff.yaml.' : 'Takeoff can\'t read takeoff.yaml right now, so it can\'t check the area. Propose without one, or try again.');
    areaId = area.id;
  }
  const id = makeAgreementId(deps.now().toISOString().slice(0, 10), text, deps.random());
  const row = await deps.agreements.create({ id, projectId: project.id, areaId, text, source, proposedBy: user.id, proposedByName: displayName(user) || null });
  // Proposing it is agreeing to it.
  await deps.agreementVotes.upsert(row.id, user.id, { vote: 'agree' });
  await notifyMembers(project, 'agreement_proposed', row, {
    except: user.id,
    subject: `New proposal: ${quote(text)}`,
    body: `${displayName(user) || 'A teammate'} proposed an agreement:\n\n"${text}"\n\nAgree, or say "Not yet" with what's missing.`,
  }, deps);
  const final = await acceptIfEveryoneAgreed(project, row, user, deps);
  const { agreements } = await view(project, [final], user, deps);
  return { agreement: agreements[0] };
}

async function vote({ project, user, agreementId, body = {} }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const agreement = await loadAgreement(project, agreementId, deps);
  if (agreement.status !== 'proposed') throw AppError.conflict('This agreement is already decided.');
  const choice = body.vote;
  if (choice !== 'agree' && choice !== 'not_yet') throw AppError.badRequest('Vote "agree" or "not_yet".');
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (choice === 'not_yet' && !comment) throw AppError.badRequest('Say what\'s missing when you choose "Not yet".');
  if (comment.length > MAX_COMMENT) throw AppError.badRequest(`Keep the comment under ${MAX_COMMENT} characters.`);
  await deps.agreementVotes.upsert(agreement.id, user.id, { vote: choice, comment: comment || null });
  if (choice === 'not_yet' && agreement.proposed_by !== user.id) {
    const proposer = (await currentMembers(project, deps)).find((m) => m.userId === agreement.proposed_by);
    if (proposer) {
      await notifyMembers(project, 'agreement_not_yet', agreement, {
        to: [proposer],
        subject: `Not yet: ${quote(agreement.text)}`,
        body: `${displayName(user) || 'A teammate'} said "Not yet" to your proposal:\n\n"${agreement.text}"\n\nTheir comment: ${comment}`,
      }, deps);
    }
  }
  const final = await acceptIfEveryoneAgreed(project, agreement, user, deps);
  const { agreements } = await view(project, [final], user, deps);
  return { agreement: agreements[0] };
}

async function withdraw({ project, user, agreementId }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const agreement = await loadAgreement(project, agreementId, deps);
  if (agreement.proposed_by !== user.id) throw AppError.forbidden('Only the person who proposed it can withdraw it.');
  const row = await deps.agreements.decide(project.id, agreement.id, { status: 'withdrawn', decidedBy: user.id, via: 'withdrawn' });
  if (!row) throw AppError.conflict('This agreement is already decided.');
  const { agreements } = await view(project, [row], user, deps);
  return { agreement: agreements[0] };
}

/** The 48-hour fallback: decide a stalled proposal alone, with a reason. */
async function decide({ project, user, agreementId, body = {} }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const agreement = await loadAgreement(project, agreementId, deps);
  if (agreement.status !== 'proposed') throw AppError.conflict('This agreement is already decided.');
  const outcome = body.outcome;
  if (outcome !== 'accept' && outcome !== 'decline') throw AppError.badRequest('Decide "accept" or "decline".');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) throw AppError.badRequest('Say why you\'re deciding this on your own.');
  if (note.length > MAX_COMMENT) throw AppError.badRequest(`Keep the reason under ${MAX_COMMENT} characters.`);

  const votes = await deps.agreementVotes.listFor([agreement.id]);
  if (!isStalled(agreement, votes, deps.now())) {
    throw AppError.conflict(votes.some((v) => v.vote === 'not_yet')
      ? 'Someone said "Not yet", so this needs the team, not one person.'
      : 'This can be decided alone only after 48 hours without a "Not yet".');
  }
  const intent = await deps.readIntent(project);
  const right = await decideRight(project, agreement, user, intent, deps);
  if (!right.canDecide) {
    throw AppError.forbidden(agreement.area_id
      ? 'Only a Creator of this area (in takeoff.yaml) can decide it alone.'
      : 'Only someone with write access to the repo can decide this alone.');
  }

  const members = await currentMembers(project, deps);
  const agreedIds = new Set(votes.filter((v) => v.vote === 'agree').map((v) => v.user_id));
  agreedIds.add(user.id);
  const emails = members.filter((m) => agreedIds.has(m.userId)).map((m) => m.email).filter(Boolean);
  const mine = confirmedEmail(user);
  if (mine) emails.push(mine);

  const row = await deps.agreements.decide(project.id, agreement.id, {
    status: outcome === 'accept' ? 'accepted' : 'declined',
    decidedBy: user.id,
    via: 'stall_fallback',
    note,
    agreedByEmails: outcome === 'accept' ? [...new Set(emails)] : null,
  });
  if (!row) throw AppError.conflict('This agreement is already decided.');
  console.log(JSON.stringify({ event: 'agreement_decided_alone', projectId: project.id, agreementId: row.id, outcome, decidedBy: user.id }));
  if (outcome === 'accept') {
    await notifyMembers(project, 'agreement_accepted', row, {
      subject: `Agreed: ${quote(row.text)}`,
      body: `${displayName(user) || 'A teammate'} accepted this after 48 hours with no "Not yet":\n\n"${row.text}"\n\nWhy: ${note}`,
    }, deps);
    await startCommit(project, row, user, deps);
  }
  const fresh = (await deps.agreements.get(project.id, row.id)) || row;
  const { agreements } = await view(project, [fresh], user, deps);
  return { agreement: agreements[0] };
}

/** Try the commit again after it failed. */
async function retryCommit({ project, user, agreementId }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const agreement = await loadAgreement(project, agreementId, deps);
  if (agreement.status !== 'accepted' || !['failed', 'none'].includes(agreement.commit_state)) {
    throw AppError.conflict('There is nothing to retry on this agreement.');
  }
  await startCommit(project, agreement, user, deps);
  const fresh = (await deps.agreements.get(project.id, agreement.id)) || agreement;
  const { agreements } = await view(project, [fresh], user, deps);
  return { agreement: agreements[0] };
}

/** Register the committing action once, with the deps it runs with. */
let registered = false;
function registerCommitAction(depsFactory = defaultDeps) {
  if (registered) return;
  registered = true;
  committing.registerCommittingAction(COMMIT_ACTION, {
    summarize: () => 'Add an agreed agreement to takeoff.yaml',
    run: async ({ project, payload }) => {
      const deps = depsFactory();
      return commitAgreement({ project, agreementId: String(payload.agreementId || '') }, deps);
    },
  });
}

module.exports = {
  listAgreements, propose, vote, withdraw, decide, retryCommit,
  registerCommitAction, defaultDeps, isStalled, STALL_MS, COMMIT_ACTION,
  _resetRegistration: () => { registered = false; committing._actions.delete(COMMIT_ACTION); },
};
