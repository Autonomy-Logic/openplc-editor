import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CONSTANTS } from '~/utils';
// import { ThemeProps } from '../../types/theme';

// Todo: Create or use the ipc communication
// import { useIpcRender } from '@/hooks';
/**
 * Destructure necessary properties from the CONSTANTS module.
 */
const {
  theme: { variants },
  //  channels: { get, set },
} = CONSTANTS;
/**
 * Type representing the possible theme states.
 */
export type ThemeState = typeof variants.DARK | typeof variants.LIGHT;
/**
 * Context data type for managing theme.
 */
export type ThemeContextData = {
  /**
   * Current theme state.
   */
  theme?: ThemeState;
  /**
   * Function to toggle the theme.
   */
  toggleTheme: () => void;
};
/**
 * Context for managing theme state.
 */
export const ThemeContext = createContext<ThemeContextData>(
  {} as ThemeContextData,
);
/**
 * Provider component for managing theme state.
 * @returns A JSX Component with the theme context provider
 */
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const ThemeProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * Todo: Resolve ipc communication
   * Extract the invoke function from ipc render hook to manipulate the theme state.
   */
  // const { invoke } = useIpcRender<ThemeProps | undefined, ThemeProps>();
  /**
   * State to store the current theme.
   */
  const [theme, setTheme] = useState<ThemeState>();
  /**
   * Access the `documentElement` of the `document`.
   */
  const { documentElement: html } = document;
  /**
   * Adds the dark theme class to the HTML element.
   */
  const addDarkClass = useCallback(() => {
    html.classList.add(variants.DARK);
  }, [html.classList]);
  /**
   * Removes the dark theme class from the HTML element.
   */
  const removeDarkClass = useCallback(() => {
    html.classList.remove(variants.DARK);
  }, [html.classList]);
  /**
   * Toggles between light and dark themes.
   */
  const toggleTheme = useCallback(() => {
    setTheme((state) => {
      if (state === variants.LIGHT) {
        addDarkClass();
        // Todo: Resolve ipc communication
        // invoke(set.THEME, variants.DARK);
        return variants.DARK;
      }
      removeDarkClass();
      // Todo: Resolve ipc communication
      // invoke(set.THEME, variants.LIGHT);
      return variants.LIGHT;
    });
  }, [addDarkClass, removeDarkClass]);
  /**
   * Use effect hook to set the initial theme based on user preferences or stored theme.
   */
  useEffect(() => {
    const getStoredTheme = async () => {
      // Todo: Resolve ipc communication
      // await invoke(get.THEME);
      const storedTheme = '';
      setTheme(() => {
        if (storedTheme) {
          if (storedTheme === variants.DARK) {
            addDarkClass();
            return variants.DARK;
          }
          removeDarkClass();
          return variants.LIGHT;
        }
        if (
          window.matchMedia(`(prefers-color-scheme: ${variants.DARK})`).matches
        ) {
          addDarkClass();
          return variants.DARK;
        }
        removeDarkClass();
        return variants.LIGHT;
      });
    };
    getStoredTheme();
  }, [addDarkClass, removeDarkClass]);
  /**
   * Memoize the context data.
   */
  const defaultValues = useMemo(
    () => ({
      theme,
      toggleTheme,
    }),
    [theme, toggleTheme],
  );
  /**
   * Provide the context with theme data.
   */
  return (
    <ThemeContext.Provider value={defaultValues}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeProvider;
