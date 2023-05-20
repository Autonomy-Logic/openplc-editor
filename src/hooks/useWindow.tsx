import { useContext } from 'react';

import { WindowContext } from '@/contexts';
import { WindowContextData } from '@/contexts/Window';

const useWindow = (): WindowContextData => {
  const context = useContext(WindowContext);
  if (!context) throw new Error('useWindow must be used within a WindowProvider');
  return context;
};

export default useWindow;
