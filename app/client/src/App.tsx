import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import Results from './pages/Results';
import ReviewProgress from './pages/ReviewProgress';
import ReviewReport from './pages/ReviewReport';
import FixPrompt from './pages/FixPrompt';
import NotFound from './pages/NotFound';

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/analyze/:id" element={<Analysis />} />
            <Route path="/results/:id" element={<Results />} />
            <Route path="/review/:id/progress" element={<ReviewProgress />} />
            <Route path="/review/:id" element={<ReviewReport />} />
            <Route path="/fix/:shortId" element={<FixPrompt />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
