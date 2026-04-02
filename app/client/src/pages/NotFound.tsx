import { Link } from 'react-router-dom';
import Header from '../components/Header';

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="flex flex-col items-center justify-center px-6 py-32 text-center space-y-6">
        <h1 className="text-4xl font-bold text-neutral-200">Page not found</h1>
        <p className="text-neutral-500 max-w-md">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
        >
          Go home
        </Link>
      </main>
    </div>
  );
}
