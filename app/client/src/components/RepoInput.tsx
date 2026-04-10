import { useState } from 'react';
import { ArrowRight, Loader } from 'lucide-react';

interface Props {
  onSubmit: (url: string) => void;
  loading?: boolean;
}

export default function RepoInput({ onSubmit, loading }: Props) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full max-w-lg mx-auto">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo"
        className="flex-1 px-4 py-3 rounded-xl glass text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-all text-sm"
      />
      <button
        type="submit"
        disabled={loading || !url.trim()}
        className="px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-sm flex items-center gap-2 transition-all btn-glow"
      >
        {loading ? <Loader size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        Analyze
      </button>
    </form>
  );
}
