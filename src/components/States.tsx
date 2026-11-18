/** Shared loading / empty / error screens. */
import { Link } from 'react-router-dom';
import { Loader2, SearchX } from 'lucide-react';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-content-muted">
      <Loader2 size={22} className="animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function NotFound({ label = 'Not found.' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <SearchX size={26} className="text-content-muted" />
      <p className="text-sm text-content-secondary">{label}</p>
      <Link to="/" className="btn-outline mt-1">Back to courses</Link>
    </div>
  );
}
