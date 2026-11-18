/** Sign-in gate. Offers local mode when Firebase isn't configured yet. */
import { BookOpen, HardDrive, LogIn } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { firebaseEnabled } from '../lib/firebase';

export function SignIn() {
  const signIn = useAuth((s) => s.signIn);
  const useLocalAccount = useAuth((s) => s.useLocalAccount);
  const error = useAuth((s) => s.error);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm animate-fade-up p-8 text-center">
        <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-brand-contrast">
          <BookOpen size={22} />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">LearnHub</h1>
        <p className="mt-2 text-sm text-content-secondary">
          Your courses, your progress, your study clock — in one place.
        </p>

        {firebaseEnabled ? (
          <>
            <button onClick={() => void signIn()} className="btn-primary mt-7 w-full">
              <LogIn size={15} /> Continue with Google
            </button>
            <p className="mt-3 text-[11px] text-content-muted">
              Progress syncs across every device you sign in on.
            </p>
          </>
        ) : (
          <>
            <button onClick={useLocalAccount} className="btn-primary mt-7 w-full">
              <HardDrive size={15} /> Continue on this device
            </button>
            <p className="mt-3 text-[11px] text-content-muted">
              Firebase isn't configured, so progress is saved in this browser only.
              Add your keys to <code className="font-mono">.env.local</code> to enable sync.
            </p>
          </>
        )}

        {error && <p className="mt-4 text-xs text-negative">{error}</p>}
      </div>
    </div>
  );
}
