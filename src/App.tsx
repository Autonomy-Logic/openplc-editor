import React from 'react';
import { ToastContainer } from 'react-toastify';

import {
  ProjectProvider,
  RouterProvider,
  ThemeProvider,
  TitlebarProvider,
  ToastProvider,
} from './contexts';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <TitlebarProvider>
          <ProjectProvider>
            <RouterProvider />
            <ToastContainer closeButton={false} closeOnClick={false} />
          </ProjectProvider>
        </TitlebarProvider>
      </ToastProvider>
    </ThemeProvider>
  );
};

export default App;
