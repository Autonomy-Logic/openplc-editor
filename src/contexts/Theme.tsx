import { CONSTANTS } from '@shared/constants';
import { ThemeProps } from '@shared/types/theme';
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { useIpcRender } from '@/hooks';

const {
  theme: { variants },
  channels: { get, set },
} = CONSTANTS;

export type ThemeState = typeof variants.DARK | typeof variants.LIGHT;

export type ThemeContextData = {
  theme?: ThemeState;
  toggleTheme: () => void;
};

export const ThemeContext = createContext<ThemeContextData>({} as ThemeContextData);

const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { send, data: storedTheme } = useIpcRender<ThemeProps>(
    {
      get: get.THEME,
      set: set.THEME,
    },
    '',
  );

  const [theme, setTheme] = useState<ThemeState>();

  const { documentElement: html } = document;

  const addDarkClass = useCallback(() => {
    html.classList.add(variants.DARK);
  }, [html.classList]);

  const removeDarkClass = useCallback(() => {
    html.classList.remove(variants.DARK);
  }, [html.classList]);

  const toggleTheme = useCallback(() => {
    setTheme((state) => {
      if (state === variants.LIGHT) {
        addDarkClass();
        send(variants.DARK);
        return variants.DARK;
      } else {
        removeDarkClass();
        send(variants.LIGHT);
        return variants.LIGHT;
      }
    });
  }, [addDarkClass, removeDarkClass, send]);

  useEffect(() => {
    if (storedTheme !== '') {
      setTheme(() => {
        if (storedTheme) {
          if (storedTheme === variants.DARK) {
            addDarkClass();
            return variants.DARK;
          } else {
            removeDarkClass();
            return variants.LIGHT;
          }
        } else if (
          window.matchMedia(`(prefers-color-scheme: ${variants.DARK})`).matches
        ) {
          addDarkClass();
          return variants.DARK;
        } else {
          removeDarkClass();
          return variants.LIGHT;
        }
      });
    }
  }, [addDarkClass, storedTheme, removeDarkClass]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeProvider;
