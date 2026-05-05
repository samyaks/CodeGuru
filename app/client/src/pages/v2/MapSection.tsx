import { useEffect, useMemo, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { PersonaCard, EmptyState } from '../../components/v2';
import { fetchProductMap, type ProductMapData } from '../../services/productMapApi';

export interface MapSectionProps {
  projectId: string;
}

export function MapSection({ projectId }: MapSectionProps) {
  const [data, setData] = useState<ProductMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProductMap(projectId)
      .then((next) => { if (!cancelled) setData(next); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const personas = useMemo(() => {
    if (!data) return [] as Array<{ id: string; name: string; emoji: string; readiness: number; jobsCount: number }>;
    const personaScores = data.scores?.persona ?? {};
    const jobsByPersona = new Map<string, number>();
    for (const job of data.jobs) {
      jobsByPersona.set(job.personaId, (jobsByPersona.get(job.personaId) || 0) + 1);
    }
    return data.personas.map((p) => {
      const rawScore = personaScores[p.id];
      const readiness = typeof rawScore === 'number'
        ? Math.round(rawScore * 100)
        : Math.round((data.scores?.app ?? 0.5) * 100);
      return {
        id: p.id,
        name: p.name,
        emoji: p.emoji ?? '📌',
        readiness,
        jobsCount: jobsByPersona.get(p.id) || 0,
      };
    });
  }, [data]);

  const weakest = useMemo(() => {
    if (personas.length === 0) return null;
    return personas.reduce((min, p) => (p.readiness < min.readiness ? p : min), personas[0]);
  }, [personas]);

  if (loading) {
    return <div className="text-sm text-stone-500">Loading personas…</div>;
  }
  if (error) {
    return <EmptyState title="Couldn't load product map" description={error} />;
  }
  if (personas.length === 0) {
    return (
      <EmptyState
        title="No personas yet"
        description="Run an analysis from the Takeoff intake flow to extract personas and jobs from your codebase."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">Who it's for, what they need</h3>
        <p className="text-stone-600 text-sm leading-relaxed">
          Personas Claude detected, weighted by how much your code already supports their jobs.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {personas.map((p) => (
          <PersonaCard
            key={p.id}
            persona={{ name: p.name, icon: p.emoji, readiness: p.readiness, jobs: p.jobsCount }}
            // Inline jobs editor is deferred; the wizard route is being killed
            // in Phase 5. PersonaCard renders no edit affordance when onEdit
            // is omitted.
          />
        ))}
        <div
          className="bg-stone-50 border border-dashed border-stone-300 rounded-lg p-5 flex items-center justify-center text-stone-400 text-sm"
        >
          + Add persona (inline editor coming soon)
        </div>
      </div>

      {weakest ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <Lightbulb className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <strong>{weakest.name} is your weakest persona</strong> at {weakest.readiness}%. The Missing Functionality gaps that affect them are likely your highest-impact fixes.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default MapSection;
