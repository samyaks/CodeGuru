import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import RequireAuth from './components/RequireAuth';
import { TakeoffAnnotate } from '@takeoff/annotate';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import Results from './pages/Results';
import ReviewProgress from './pages/ReviewProgress';
import ReviewReport from './pages/ReviewReport';
import FixPrompt from './pages/FixPrompt';
import AnalysisProgress from './pages/AnalysisProgress';
import ProductionPlan from './pages/ProductionPlan';
import DeployProgress from './pages/DeployProgress';
import EnvSetup from './pages/EnvSetup';
import ProjectView from './pages/ProjectView';
import ProductMap from './pages/ProductMap';
import ProductMapOnboarding from './pages/ProductMapOnboarding';
import BuildStory from './pages/BuildStory';
import ShareableStory from './pages/ShareableStory';
import AuthCallback from './pages/AuthCallback';
import NotFound from './pages/NotFound';
import StyleGuideV2 from './pages/v2/StyleGuide';

function NavigateToProject() {
  const { id } = useParams();
  return <Navigate to={`/projects/${id}`} replace />;
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
            <Route path="/projects/:id" element={<ProjectView />} />
            <Route path="/projects/:id/map" element={<ProductMap />} />
            <Route path="/projects/:id/map/onboard" element={<ProductMapOnboarding />} />
            <Route path="/projects/:id/story" element={<RequireAuth><BuildStory /></RequireAuth>} />

            {/* Takeoff flow */}
            <Route path="/takeoff/:id" element={<AnalysisProgress />} />
            <Route path="/takeoff/:id/report" element={<NavigateToProject />} />
            <Route path="/takeoff/:id/suggestions" element={<NavigateToProject />} />
            <Route path="/takeoff/:id/plan" element={<ProductionPlan />} />
            <Route path="/takeoff/:id/env-setup" element={<RequireAuth><EnvSetup /></RequireAuth>} />
            <Route path="/deploy/:id" element={<RequireAuth><DeployProgress /></RequireAuth>} />

            {/* Legacy CodeGuru routes */}
            <Route path="/analyze/:id" element={<Analysis />} />
            <Route path="/results/:id" element={<Results />} />
            <Route path="/review/:id/progress" element={<ReviewProgress />} />
            <Route path="/review/:id" element={<ReviewReport />} />
            <Route path="/fix/:shortId" element={<FixPrompt />} />

            {/* v2 (Takeoff) — additive routes, do not affect v1 */}
            <Route path="/v2/style-guide" element={<StyleGuideV2 />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </TakeoffAnnotate>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
