import type { ReactNode } from 'react';

export type Locale = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';
export type Tone = 'neutral' | 'primary' | 'positive' | 'warning' | 'critical';

export interface NavigationItem {
  id: string;
  label: string;
  shortLabel?: string;
  badge?: string;
}

export interface ShellContext {
  eyebrow: string;
  title: string;
  meta: string;
}

export interface DrilldownItem {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
}

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}
