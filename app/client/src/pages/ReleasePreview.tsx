import { Link, useNavigate, useParams } from 'react-router-dom';
import { IntakeView } from './story/IntakeView';
import { gapPrompt, promptFor, useProjectStory } from './story/load';
import { ProjectStoryView, type BuildTarget, type CopyResult } from './story/ProjectStoryView';
import { ApiError } from '../lib/api-error';
import { useAuth } from '../hooks/useAuth';
import { track } from '../services/telemetry';
import { SAMPLE_INTAKE } from './story/sample';
import { cx } from '../components/takeoff/status';
import { TeamSection } from './team/TeamSection';
import { AgreementsSection } from './team/AgreementsSection';
import { DriftSection } from './team/DriftSection';
import { OverviewSection } from './team/OverviewSection';
import styles from './ReleasePreview.module.css';

// Release 11.15.26: the new project page reads real data (launch checks,
// the read, recent merges). The intake conversation still uses a sample
// script. The previous Read page stays at /old/read/:id for comparison.

export const RELEASE = '11.15.26';

function Banner({ oldHref, label }: { oldHref?: string; label: string }) {
  return (
    <div className={cx('takeoff', styles.banner)} role="note">
      <span className="type-small">
        Release {RELEASE}. {label}
      </span>
      {oldHref ? (
        <Link className={cx('type-small', styles.link)} to={oldHref}>
          See the old version
        </Link>
      ) : null}
    </div>
  );
}

export function ReleaseProject() {
  const { id } = useParams();
  const { user, login } = useAuth();
  const { story, loading, error, reload } = useProjectStory(id, !!user);
  const copyPrompt = (checkId: string) => {
    const check = story?.checks.find((c) => c.id === checkId);
    if (check) void navigator.clipboard?.writeText(promptFor(check));
  };
  const copyBuild = async (target: BuildTarget): Promise<CopyResult> => {
    if (!id || !story?.build) return 'failed';
    try {
      const gap = target.kind === 'gap' ? story.build.gaps.find((g) => g.id === target.id) : null;
      const text = target.kind === 'next' ? story.build.next?.prompt : gap ? await gapPrompt(id, gap) : null;
      if (!text) return 'failed';
      await navigator.clipboard.writeText(text);
      track('prompt_copied', {
        projectId: id,
        metadata: target.kind === 'next' ? { source: 'next-thing' } : { source: 'gap', gapId: target.id },
      });
      return 'copied';
    } catch (err) {
      return err instanceof ApiError && err.status === 401 ? 'signin' : 'failed';
    }
  };
  return (
    <>
      <Banner oldHref={`/old/read/${id}`} label="This is the new project page." />
      <ProjectStoryView
        story={story}
        loading={loading}
        error={error}
        onRetry={reload}
        onCopyPrompt={copyPrompt}
        onCopyBuild={copyBuild}
        onSignIn={() => login('github')}
        oldHref={`/old/read/${id}`}
        team={user && id ? (
          <>
            <OverviewSection projectId={id} />
            <DriftSection projectId={id} />
            <AgreementsSection projectId={id} />
            <TeamSection projectId={id} />
          </>
        ) : null}
      />
    </>
  );
}

export function ReleaseIntake() {
  const navigate = useNavigate();
  return (
    <>
      <Banner label="This is the new intake conversation. Sample questions, not your project." />
      <IntakeView script={SAMPLE_INTAKE} onFinish={() => navigate('/dashboard')} />
    </>
  );
}
