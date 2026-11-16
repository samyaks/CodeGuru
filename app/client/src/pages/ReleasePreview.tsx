import { Link, useNavigate, useParams } from 'react-router-dom';
import { IntakeView } from './story/IntakeView';
import { promptFor, useProjectStory } from './story/load';
import { ProjectStoryView } from './story/ProjectStoryView';
import { SAMPLE_INTAKE } from './story/sample';
import { cx } from '../components/takeoff/status';
import styles from './ReleasePreview.module.css';

// Release 11.15.26: the new project page reads real data (launch checks,
// the read, recent merges). The intake conversation still uses a sample
// script. The previous Read page stays at /old/read/:id for comparison.

export const RELEASE = '11.15.26';

function Banner({ oldHref, label, real }: { oldHref?: string; label: string; real?: boolean }) {
  return (
    <div className={cx('takeoff', styles.banner)} role="note">
      <span className="type-small">
        Release {RELEASE}. {label}{real ? '' : ' Sample data, not your project.'}
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
  const { story, loading, error, reload } = useProjectStory(id);
  const copyPrompt = (checkId: string) => {
    const check = story?.checks.find((c) => c.id === checkId);
    if (check) void navigator.clipboard?.writeText(promptFor(check));
  };
  return (
    <>
      <Banner oldHref={`/old/read/${id}`} label="This is the new project page." real />
      <ProjectStoryView
        story={story}
        loading={loading}
        error={error}
        onRetry={reload}
        onCopyPrompt={copyPrompt}
        oldHref={`/old/read/${id}`}
      />
    </>
  );
}

export function ReleaseIntake() {
  const navigate = useNavigate();
  return (
    <>
      <Banner label="This is the new intake conversation." />
      <IntakeView script={SAMPLE_INTAKE} onFinish={() => navigate(-1)} />
    </>
  );
}
