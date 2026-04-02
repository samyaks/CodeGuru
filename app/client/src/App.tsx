import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import Results from './pages/Results';
import ReviewProgress from './pages/ReviewProgress';
import ReviewReport from './pages/ReviewReport';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/analyze/:id" element={<Analysis />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/review/:id/progress" element={<ReviewProgress />} />
          <Route path="/review/:id" element={<ReviewReport />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
