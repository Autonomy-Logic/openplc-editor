import { useContext } from 'react';

import { TitlebarContext } from '@/contexts';
import { TitlebarContextData } from '@/contexts/Titlebar';

const useTitlebar = (): TitlebarContextData => {
  const context = useContext(TitlebarContext);
  if (!context) throw new Error('useTitlebar must be used within a TitlebarProvider');
  return context;
};

export default useTitlebar;
