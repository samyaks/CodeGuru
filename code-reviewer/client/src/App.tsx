import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import UserHeader from './components/UserHeader';
import Dashboard from './pages/Dashboard';
import ReviewProgress from './pages/ReviewProgress';
import ReviewReport from './pages/ReviewReport';
import LoginPage from './pages/LoginPage';
import AuthCallback from './pages/AuthCallback';
import './App.css';

function AppContent() {
  const auth = useAuthProvider();

  if (auth.loading) {
    return <div className="app"><div className="loading-text">Loading...</div></div>;
  }

  if (!auth.user) {
    return (
      <AuthContext.Provider value={auth}>
        <BrowserRouter>
          <div className="app">
            <Routes>
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="*" element={<LoginPage />} />
            </Routes>
          </div>
        </BrowserRouter>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <div className="app">
          <UserHeader />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/review/:id/progress" element={<ReviewProgress />} />
            <Route path="/review/:id" element={<ReviewReport />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

export default function App() {
  return <AppContent />;
}
