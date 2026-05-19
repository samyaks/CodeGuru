import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import RequireAuth from './components/RequireAuth';
import { TakeoffAnnotate } from '@takeoff/annotate';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import AnalysisProgress from './pages/AnalysisProgress';
import BuildStory from './pages/BuildStory';
import ShareableStory from './pages/ShareableStory';
import AuthCallback from './pages/AuthCallback';
import NotFound from './pages/NotFound';
import StyleGuideV2 from './pages/v2/StyleGuide';
import ProjectV2 from './pages/v2/Project';
import SecurityReportV2 from './pages/v2/SecurityReport';

function NavigateToProject() {
  const { id } = useParams();
  return <Navigate to={`/projects/${id}`} replace />;
}

// Old v1 ProductMap routes are killed in Phase 5; redirect to the project Map tab.
function NavigateToV2Map() {
  const { id } = useParams();
  return <Navigate to={`/projects/${id}#map`} replace />;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <TakeoffAnnotate defaultMode="clean" position="bottom-right">
          <Routes>
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />

            {/* Public story (no auth required) */}
            <Route path="/story/:slug" element={<ShareableStory />} />

            {/* Projects — reads are public for user_id:null projects, writes need auth */}
            <Route path="/projects/:id" element={<ProjectV2 />} />
            {/* Phase 5: v1 ProductMap wizard is replaced by the v2 Map tab. */}
            <Route path="/projects/:id/map" element={<NavigateToV2Map />} />
            <Route path="/projects/:id/map/onboard" element={<NavigateToV2Map />} />
            <Route path="/projects/:id/story" element={<RequireAuth><BuildStory /></RequireAuth>} />

            {/* Takeoff flow */}
            <Route path="/takeoff/:id" element={<AnalysisProgress />} />
            <Route path="/takeoff/:id/report" element={<NavigateToProject />} />
            <Route path="/takeoff/:id/suggestions" element={<NavigateToProject />} />

            {/* v2 (Takeoff) — additive routes, do not affect v1 */}
            <Route path="/v2/style-guide" element={<StyleGuideV2 />} />
            {/* Legacy /v2/projects/:id URL — canonical is /projects/:id. */}
            <Route path="/v2/projects/:id" element={<NavigateToProject />} />
            <Route path="/v2/projects/:id/security" element={<SecurityReportV2 mode="owner" />} />
            {/* Public, no-auth share view. Mounted as a top-level path
                so it can never be accidentally gated by auth wrappers. */}
            <Route path="/v2/security/shared/:slug" element={<SecurityReportV2 mode="shared" />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </TakeoffAnnotate>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
