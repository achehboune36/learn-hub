/**
 * Course icons.
 *
 * Deliberately a curated map rather than `import * as icons from 'lucide-react'`
 * — the wildcard import pulls all ~1,500 icons into the eager bundle (over a
 * megabyte). To use an icon that isn't here, add one line below; the app falls
 * back to BookOpen rather than breaking.
 */
import {
  BookOpen, Library, Database, Braces, Brain, Cpu, Network, Server, Cloud,
  Boxes, Binary, Terminal, GitBranch, LineChart, BarChart3, Shield, Lock,
  Workflow, Layers, Sparkles, Bot, Search, FlaskConical, Rocket, Compass,
  Puzzle, Wrench, Container, Globe, Zap, PenTool, Scale, Calculator, Table2,
  type LucideProps,
} from 'lucide-react';

const ICONS = {
  BookOpen, Library, Database, Braces, Brain, Cpu, Network, Server, Cloud,
  Boxes, Binary, Terminal, GitBranch, LineChart, BarChart3, Shield, Lock,
  Workflow, Layers, Sparkles, Bot, Search, FlaskConical, Rocket, Compass,
  Puzzle, Wrench, Container, Globe, Zap, PenTool, Scale, Calculator, Table2,
} as const;

/** Names a course may use in `meta.icon`. */
export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Component = ICONS[name as IconName] ?? BookOpen;
  return <Component {...props} />;
}

/** Accent -> tailwind classes, kept in one place so courses stay declarative. */
export const ACCENT_CLASSES: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  indigo:  { text: 'text-indigo-400',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/25',  dot: 'bg-indigo-400' },
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', dot: 'bg-emerald-400' },
  amber:   { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   dot: 'bg-amber-400' },
  rose:    { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/25',    dot: 'bg-rose-400' },
  sky:     { text: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/25',     dot: 'bg-sky-400' },
  violet:  { text: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/25',  dot: 'bg-violet-400' },
  teal:    { text: 'text-teal-400',    bg: 'bg-teal-500/10',    border: 'border-teal-500/25',    dot: 'bg-teal-400' },
  orange:  { text: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/25',  dot: 'bg-orange-400' },
};

export function accent(name: string) {
  return ACCENT_CLASSES[name] ?? ACCENT_CLASSES.indigo;
}
