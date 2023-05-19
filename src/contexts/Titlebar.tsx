import { Color, Titlebar } from 'custom-electron-titlebar';
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react';
import colors from 'tailwindcss/colors';

import { useTheme } from '@/hooks';

export type TitlebarProps = InstanceType<typeof Titlebar>;

export type TitlebarContextData = {
  updateBackground: (color: string) => TitlebarProps | undefined;
};

export const TitlebarContext = createContext<TitlebarContextData>(
  {} as TitlebarContextData,
);

const TitlebarProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [titlebar, setTitlebar] = useState<TitlebarProps>();
  const { theme } = useTheme();

  const updateBackground = useCallback(
    (color: string) => titlebar?.updateBackground(Color?.fromHex(color)),
    [titlebar],
  );

  useEffect(() => {
    setTitlebar((state) =>
      state
        ? state
        : new Titlebar({
            containerOverflow: 'hidden',
          }),
    );
  }, [theme]);

  useEffect(() => {
    if (titlebar) updateBackground(theme === 'dark' ? colors.gray['900'] : colors.white);
  }, [theme, titlebar, updateBackground]);

  return (
    <TitlebarContext.Provider value={{ updateBackground }}>
      {children}
    </TitlebarContext.Provider>
  );
};

export default TitlebarProvider;
