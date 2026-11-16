import { Link, useNavigate, useParams } from 'react-router-dom';
import { IntakeView } from './story/IntakeView';
import { ProjectStoryView } from './story/ProjectStoryView';
import { SAMPLE_INTAKE, SAMPLE_STORY } from './story/sample';
import { cx } from '../components/takeoff/status';
import styles from './ReleasePreview.module.css';

// Release 11.15.26: the new project page and intake, shown with made-up data
// until they are wired to the API. The previous Read page stays at
// /old/read/:id so the two can be compared side by side.

export const RELEASE = '11.15.26';

function Banner({ oldHref, label }: { oldHref?: string; label: string }) {
  return (
    <div className={cx('takeoff', styles.banner)} role="note">
      <span className="type-small">
        Release {RELEASE}. {label} Sample data, not your project.
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
  const navigate = useNavigate();
  return (
    <>
      <Banner oldHref={`/old/read/${id}`} label="This is the new project page." />
      <ProjectStoryView
        story={SAMPLE_STORY}
        loading={false}
        error={null}
        onRetry={() => navigate(0)}
        intakeHref="/intake"
        onCopyPrompt={() => {}}
        onEditTold={() => navigate('/intake')}
        onRedo={() => {}}
      />
    </>
  );
}

export function ReleaseIntake() {
  const navigate = useNavigate();
  return (
    <>
      <Banner label="This is the new intake conversation." />
      <IntakeView script={SAMPLE_INTAKE} onFinish={() => navigate('/read/sample')} />
    </>
  );
}
