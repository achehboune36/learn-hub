import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { SignIn } from './pages/SignIn';
import { Loading } from './components/States';
import { useAuth } from './store/useAuth';
import { useProgress } from './store/useProgress';
import { useTimerLifecycle } from './hooks/useTimerLifecycle';

// Route-level splitting: the markdown renderer, syntax highlighter and mermaid
// only download when a chapter is actually opened.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const CoursePage = lazy(() => import('./pages/CoursePage').then((m) => ({ default: m.CoursePage })));
const ChapterPage = lazy(() => import('./pages/ChapterPage').then((m) => ({ default: m.ChapterPage })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));

export default function App() {
  const account = useAuth((s) => s.account);
  const ready = useAuth((s) => s.ready);
  const init = useAuth((s) => s.init);

  const load = useProgress((s) => s.load);
  const reset = useProgress((s) => s.reset);
  const loaded = useProgress((s) => s.loaded);
  const uid = useProgress((s) => s.uid);

  useEffect(() => { init(); }, [init]);

  // One profile read + one progress read per signed-in session.
  useEffect(() => {
    if (!account) { if (uid) reset(); return; }
    if (uid !== account.uid) reset();
    void load(account);
  }, [account, uid, load, reset]);

  useTimerLifecycle(Boolean(account));

  if (!ready) return <Loading label="Starting up…" />;
  if (!account) return <SignIn />;
  if (!loaded) return <Loading label="Loading your progress…" />;

  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/course/:courseId" element={<CoursePage />} />
          <Route path="/course/:courseId/:chapterId" element={<ChapterPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
