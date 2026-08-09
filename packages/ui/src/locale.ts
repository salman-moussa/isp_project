import { useLayoutEffect } from 'react';
import type { Direction, Locale } from './types';

export const directionFor = (locale: Locale): Direction => (locale === 'ar' ? 'rtl' : 'ltr');

export function useDocumentLocale(locale: Locale): Direction {
  const direction = directionFor(locale);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [direction, locale]);

  return direction;
}

export function formatCompactNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-LB', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatMoney(value: number, currency: 'USD' | 'LBP', locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-LB', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  }).format(value);
}

export function formatBeirutTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-LB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Beirut',
  }).format(date);
}
