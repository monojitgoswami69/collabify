'use client';

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { Theme } from '@/lib/types';
import { getStoredTheme, setStoredTheme } from '@/services/storageService';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  isDark: true,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start with 'dark' to match the SSR/bootstrap default; reconcile on mount.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    setStoredTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(async () => {
    if (!(document as any).startViewTransition) {
      setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
      return;
    }

    const transition = (document as any).startViewTransition(() => {
      flushSync(() => {
        setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
      });
    });

    try {
      await transition.ready;
      
      document.documentElement.animate(
        {
          opacity: [0, 1],
        },
        {
          duration: 200, // 400 * 0.5 = 200ms
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    } catch {
      // Ignored
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
