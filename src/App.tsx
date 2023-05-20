import React from 'react';
import { ToastContainer } from 'react-toastify';

import {
  ThemeProvider,
  TitlebarProvider,
  ToastProvider,
  WindowProvider,
} from './contexts';
import { Home } from './pages';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <TitlebarProvider>
        <ToastProvider>
          <WindowProvider>
            <Home />
            <ToastContainer />
          </WindowProvider>
        </ToastProvider>
      </TitlebarProvider>
    </ThemeProvider>
  );
};

export default App;
