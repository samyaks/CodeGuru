import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IntakeView } from './story/IntakeView';
import { ProjectStoryView } from './story/ProjectStoryView';
import { SAMPLE_INTAKE, SAMPLE_STORY, SAMPLE_STORY_CLEARED } from './story/sample';

// Dev-only previews of the project page and the intake conversation with
// made-up data, since the real ones need a signed-in API. Mounted at
// /design/project and /design/intake only when import.meta.env.DEV.
//
//   /design/project?state=attention|cleared|empty|loading|error|visitor
//   /design/intake
//   ?theme=light|dark on either, otherwise the system setting.

function useThemeParam() {
  const [params] = useSearchParams();
  const theme = params.get('theme');
  useEffect(() => {
    if (theme !== 'light' && theme !== 'dark') return undefined;
    const root = document.documentElement;
    const before = root.getAttribute('data-theme');
    root.setAttribute('data-theme', theme);
    return () => {
      if (before === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', before);
    };
  }, [theme]);
}

export function DesignProject() {
  useThemeParam();
  const [params] = useSearchParams();
  const state = params.get('state') ?? 'attention';
  const navigate = useNavigate();

  const story =
    state === 'cleared' ? SAMPLE_STORY_CLEARED : state === 'empty' || state === 'error' ? null : SAMPLE_STORY;

  return (
    <ProjectStoryView
      story={story}
      loading={state === 'loading'}
      error={state === 'error' ? 'The server didn’t answer.' : null}
      onRetry={() => navigate('/design/project')}
      intakeHref="/design/intake"
      readOnly={state === 'visitor'}
      onCopyPrompt={() => {}}
      onEditTold={() => navigate('/design/intake')}
      onRedo={() => {}}
    />
  );
}

export function DesignIntake() {
  useThemeParam();
  const navigate = useNavigate();
  return <IntakeView script={SAMPLE_INTAKE} onFinish={() => navigate('/design/project')} />;
}
