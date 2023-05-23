import React from 'react';
import { ToastContainer } from 'react-toastify';

import {
  RouterProvider,
  ThemeProvider,
  TitlebarProvider,
  ToastProvider,
} from './contexts';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <TitlebarProvider>
        <ToastProvider>
          <RouterProvider />
          <ToastContainer />
        </ToastProvider>
      </TitlebarProvider>
    </ThemeProvider>
  );
};

export default App;
