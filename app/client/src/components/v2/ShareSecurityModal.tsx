import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Copy, EyeOff, Link2, Loader2, Plus, Shield, Trash2, X,
} from 'lucide-react';
import {
  createSecurityShare, listSecurityShares, revokeSecurityShare,
  type SecurityShare,
} from '../../services/v2Api';

export interface ShareSecurityModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

function buildShareUrl(slug: string): string {
  if (typeof window === 'undefined') return `/v2/security/shared/${slug}`;
  return `${window.location.origin}/v2/security/shared/${slug}`;
}

function formatCreatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ShareSecurityModal({ open, onClose, projectId }: ShareSecurityModalProps) {
  const [shares, setShares] = useState<SecurityShare[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [redactRepo, setRedactRepo] = useState(false);

  // Track which slug is currently being revoked + which slug was just
  // copied so the row can flip its icon for ~1.5s without a separate
  // toast component. Using a Map by slug instead of a single id so a
  // user mashing buttons gets the right per-row feedback.
  const [revokingSlug, setRevokingSlug] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await listSecurityShares(projectId);
      setShares(data);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load share links');
    } finally {
      setListLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    loadShares();
  }, [open, loadShares]);

  // Close on ESC. Keeping the listener inside the same effect that the
  // modal lifecycle owns means it never leaks past unmount or fires
  // when the modal isn't open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCreate = useCallback(async () => {
    setCreateLoading(true);
    setCreateError(null);
    try {
      const created = await createSecurityShare(projectId, { redactRepo });
      // Prepend so the freshly-minted link is at the top of the list
      // exactly where the user expects to see it (matches the
      // server-side sort by created_at DESC).
      setShares((prev) => [created, ...prev]);
      // Reset redact toggle after a successful create — explicit opt-in
      // for each link rather than an accidentally sticky default.
      setRedactRepo(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setCreateLoading(false);
    }
  }, [projectId, redactRepo]);

  const handleRevoke = useCallback(async (slug: string) => {
    setRevokingSlug(slug);
    try {
      await revokeSecurityShare(slug);
      setShares((prev) => prev.filter((s) => s.slug !== slug));
    } catch (err) {
      // Push the error into listError — same surface as a load-time
      // failure, which is the closest visual analog.
      setListError(err instanceof Error ? err.message : 'Failed to revoke share link');
    } finally {
      setRevokingSlug(null);
    }
  }, []);

  const handleCopy = useCallback(async (slug: string) => {
    const url = buildShareUrl(slug);
    try {
      // Modern clipboard API — falls back to a hidden textarea on
      // older browsers. We only attempt the fallback when the secure
      // API is unavailable (file:// or insecure http origins).
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedSlug(slug);
      window.setTimeout(() => {
        setCopiedSlug((cur) => (cur === slug ? null : cur));
      }, 1500);
    } catch {
      // Non-fatal — user can still copy manually from the visible URL.
    }
  }, []);

  const sharesView = useMemo(() => shares, [shares]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-security-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-white border border-stone-200 rounded-lg shadow-xl w-full max-w-lg max-h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-stone-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded bg-stone-900 text-white flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2 id="share-security-title" className="text-base font-bold text-stone-900 tracking-tight">
                Share security report
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Anyone with the link can view this report — no login required.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-stone-400 hover:text-stone-700 transition-colors p-1 -m-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Create form */}
        <div className="p-5 border-b border-stone-100 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer text-sm select-none">
            <input
              type="checkbox"
              checked={redactRepo}
              onChange={(e) => setRedactRepo(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-stone-900 font-medium inline-flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-stone-500" aria-hidden />
                Redact repo URL and owner
              </span>
              <span className="block text-xs text-stone-500 mt-0.5">
                Hides the project name, repo URL, and description on the shared page.
                Detectors and severities still appear.
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 disabled:cursor-not-allowed rounded transition-colors"
          >
            {createLoading
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <Plus className="w-4 h-4" aria-hidden />}
            Generate new link
          </button>
          {createError ? (
            <p className="flex items-start gap-1.5 text-xs text-red-600">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
              {createError}
            </p>
          ) : null}
        </div>

        {/* Active links list */}
        <div className="p-5">
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">
            Active links {sharesView.length > 0 ? `(${sharesView.length})` : ''}
          </p>
          {listLoading ? (
            <p className="text-sm text-stone-500 inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              Loading…
            </p>
          ) : listError ? (
            <p className="flex items-start gap-1.5 text-xs text-red-600">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
              {listError}
            </p>
          ) : sharesView.length === 0 ? (
            <p className="text-sm text-stone-500">
              No active share links. Generate one above to share this report.
            </p>
          ) : (
            <ul className="space-y-2">
              {sharesView.map((s) => {
                const url = buildShareUrl(s.slug);
                const copied = copiedSlug === s.slug;
                const revoking = revokingSlug === s.slug;
                return (
                  <li
                    key={s.slug}
                    className="border border-stone-200 rounded-md px-3 py-2.5 bg-stone-50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Link2 className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" aria-hidden />
                      <span className="text-xs text-stone-700 font-mono truncate flex-1 min-w-0">
                        {url}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(s.slug)}
                        aria-label="Copy link"
                        className="text-stone-500 hover:text-stone-900 transition-colors p-1 -m-1"
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />
                        ) : (
                          <Copy className="w-3.5 h-3.5" aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevoke(s.slug)}
                        disabled={revoking}
                        aria-label="Revoke link"
                        className="text-stone-500 hover:text-red-600 disabled:text-stone-300 transition-colors p-1 -m-1"
                      >
                        {revoking
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                          : <Trash2 className="w-3.5 h-3.5" aria-hidden />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-stone-500 mt-1.5 ml-5">
                      <span>Created {formatCreatedAt(s.createdAt)}</span>
                      {s.redactRepo ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <EyeOff className="w-3 h-3" aria-hidden />
                          Redacted
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-100 bg-stone-50 text-[11px] text-stone-500">
          Revoked links return a "no longer active" page immediately and cannot be re-issued.
        </div>
      </div>
    </div>
  );
}

export default ShareSecurityModal;
