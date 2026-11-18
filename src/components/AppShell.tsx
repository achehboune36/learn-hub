/** Header + page frame. The study timer lives here so it survives navigation. */
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BookOpen, Moon, Sun, User } from 'lucide-react';
import { StudyTimer } from './StudyTimer';
import { useTheme } from '../hooks/useTheme';
import { useProgress } from '../store/useProgress';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const profile = useProgress((s) => s.profile);
  const location = useLocation();
  const onChapter = /^\/course\/[^/]+\/[^/]+/.test(location.pathname);

  return (
    <div className="min-h-screen">
      {/* The chapter page renders its own sticky bar with the course progress,
          so the global header steps aside there to avoid two stacked bars. */}
      {!onChapter && (
        <header className="sticky top-0 z-40 border-b border-line bg-surface-base/95 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-brand-contrast">
                <BookOpen size={15} />
              </span>
              LearnHub
            </Link>

            <nav className="ml-3 hidden items-center gap-1 sm:flex">
              {[
                { to: '/', label: 'Courses' },
                { to: '/profile', label: 'Profile' },
              ].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-surface-sunken font-medium text-content-primary'
                        : 'text-content-secondary hover:text-content-primary'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <StudyTimer />
              <button onClick={toggle} className="btn-ghost px-2" aria-label="Toggle theme">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <Link to="/profile" aria-label="Profile" className="shrink-0">
                {profile?.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-8 w-8 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-sunken text-content-muted">
                    <User size={15} />
                  </span>
                )}
              </Link>
            </div>
          </div>
        </header>
      )}

      <main>{children}</main>
    </div>
  );
}
