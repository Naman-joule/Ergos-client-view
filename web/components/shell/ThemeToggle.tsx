'use client';
import { useEffect } from 'react';

/** Flips <html data-theme> and remembers it in the ecv_theme cookie (a year). */
export function ThemeToggle({ moonSvg, defaultMode }: { moonSvg: string; defaultMode: 'dark' | 'light' }) {
  useEffect(() => {
    // The client's config sets the theme only until the user picks one.
    if (!document.cookie.split('; ').some((c) => c.startsWith('ecv_theme='))) {
      document.documentElement.dataset.theme = defaultMode;
    }
  }, [defaultMode]);
  return (
    <button type="button" className="eg-icon-btn eg-icon-btn--sm" aria-label="Switch theme"
      onClick={() => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        document.cookie = `ecv_theme=${next}; path=/; max-age=31536000; samesite=lax`;
      }}>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: moonSvg }} />
    </button>
  );
}
