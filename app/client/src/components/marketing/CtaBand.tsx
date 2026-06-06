import { Link } from 'react-router-dom';
import { Github, ArrowRight } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface CtaBandProps {
  headline?: string;
  subhead?: string;
}

export default function CtaBand({
  headline = 'Ready to see what your repo is missing?',
  subhead = 'Connect GitHub, paste a public URL, or upload a folder — free during early access.',
}: CtaBandProps) {
  const { login } = useAuth();

  return (
    <section className="bg-stone-900 text-stone-50 rounded-2xl px-8 py-12 text-center">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3 v2-font-serif">
        {headline}
      </h2>
      <p className="text-stone-400 text-sm sm:text-base max-w-lg mx-auto mb-8 leading-relaxed">
        {subhead}
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => login('github')}
          className="inline-flex items-center justify-center gap-2 bg-stone-50 text-stone-900 hover:bg-stone-200 transition-colors rounded px-5 py-2.5 text-sm font-medium w-full sm:w-auto"
        >
          <Github className="w-4 h-4" />
          Connect GitHub
        </button>
        <Link
          to="/#analyze"
          className="inline-flex items-center justify-center gap-2 border border-stone-600 text-stone-50 hover:bg-stone-800 transition-colors rounded px-5 py-2.5 text-sm font-medium w-full sm:w-auto"
        >
          Paste a repo URL
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}
