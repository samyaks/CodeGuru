import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import RequireAuth from './components/RequireAuth';
import { TakeoffAnnotate } from '@takeoff/annotate';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import AnalysisProgress from './pages/AnalysisProgress';
import ShareableStory from './pages/ShareableStory';
import AuthCallback from './pages/AuthCallback';
import NotFound from './pages/NotFound';
import InvitePage from './pages/team/InvitePage';
import ReadPage from './pages/read/ReadPage';
import { ReleaseProject, ReleaseIntake } from './pages/ReleasePreview';
import SecurityReportV2 from './pages/v2/SecurityReport';
import MarketingLayout from './layouts/MarketingLayout';
import Features from './pages/marketing/Features';
import HowItWorks from './pages/marketing/HowItWorks';
import Pricing from './pages/marketing/Pricing';
import UseCasePage from './pages/marketing/UseCasePage';
import Demo from './pages/marketing/Demo';
import GapsIndex from './pages/marketing/GapsIndex';
import GapExplainerPage from './pages/marketing/GapExplainerPage';

// Design system review pages. Dev only: the imports are dropped from production builds.
const Design = import.meta.env.DEV ? lazy(() => import('./pages/Design')) : null;
const DesignDashboard = import.meta.env.DEV ? lazy(() => import('./pages/DesignDashboard')) : null;
const DesignProject = import.meta.env.DEV
  ? lazy(() => import('./pages/DesignStory').then((m) => ({ default: m.DesignProject })))
  : null;
const DesignIntake = import.meta.env.DEV
  ? lazy(() => import('./pages/DesignStory').then((m) => ({ default: m.DesignIntake })))
  : null;

// Canonical project surface is The Read; preserve any #tab deep link.
function NavigateToRead() {
  const { id } = useParams();
  const { hash } = useLocation();
  return <Navigate to={`/read/${id}${hash}`} replace />;
}

// Old v1 ProductMap routes are killed; personas and jobs live on the Spec tab.
function NavigateToSpec() {
  const { id } = useParams();
  return <Navigate to={`/read/${id}`} replace />;
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
            <Route element={<MarketingLayout />}>
              <Route path="/" element={<Landing />} />
              <Route path="/features" element={<Features />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/gaps" element={<GapsIndex />} />
              <Route path="/gaps/:slug" element={<GapExplainerPage />} />
              <Route path="/for/:slug" element={<UseCasePage />} />
            </Route>
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            {/* Project invites: works signed out, signing in happens on the page. */}
            <Route path="/invite/:token" element={<InvitePage />} />

            {/* Public story (no auth required) */}
            <Route path="/story/:slug" element={<ShareableStory />} />

            {/* Projects — The Read is the default surface; other sections are tabs.
                Legacy routes (/map, /map/onboard, /story) resolve to it. */}
            <Route path="/projects/:id" element={<NavigateToRead />} />
            <Route path="/projects/:id/map" element={<NavigateToSpec />} />
            <Route path="/projects/:id/map/onboard" element={<NavigateToSpec />} />
            <Route path="/projects/:id/story" element={<NavigateToRead />} />
            {/* The Read — GET is public; writes handle auth themselves */}
            {/* Release 11.15.26: new design first, previous Read page kept at /old/read/:id. */}
            <Route path="/read/:id" element={<ReleaseProject />} />
            <Route path="/old/read/:id" element={<ReadPage />} />
            <Route path="/intake" element={<ReleaseIntake />} />

            {/* Takeoff flow */}
            <Route path="/takeoff/:id" element={<AnalysisProgress />} />
            <Route path="/takeoff/:id/report" element={<NavigateToRead />} />
            <Route path="/takeoff/:id/suggestions" element={<NavigateToRead />} />

            {/* Design-system review pages, dev builds only. */}
            {Design && (
              <Route path="/design" element={<Suspense fallback={null}><Design /></Suspense>} />
            )}
            {DesignDashboard && (
              <Route path="/design/dashboard" element={<Suspense fallback={null}><DesignDashboard /></Suspense>} />
            )}
            {DesignProject && (
              <Route path="/design/project" element={<Suspense fallback={null}><DesignProject /></Suspense>} />
            )}
            {DesignIntake && (
              <Route path="/design/intake" element={<Suspense fallback={null}><DesignIntake /></Suspense>} />
            )}
            {/* Legacy /v2/projects/:id URL — canonical is /read/:id. */}
            <Route path="/v2/projects/:id" element={<NavigateToRead />} />
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
