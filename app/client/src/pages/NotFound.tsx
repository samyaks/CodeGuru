import { Link } from 'react-router-dom';
import Header from '../components/Header';

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="flex flex-col items-center justify-center px-6 py-32 text-center space-y-6">
        <h1 className="font-serif text-4xl font-light tracking-tight text-ink">Page not found</h1>
        <p className="text-sky-muted max-w-md">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="px-6 py-3 bg-ink text-paper font-mono text-[0.68rem] tracking-[0.18em] uppercase hover:bg-sky-off transition-all btn-glow"
        >
          Go home
        </Link>
      </main>
    </div>
  );
}
