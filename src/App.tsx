import React from 'react';

import { ThemeProvider, TitlebarProvider } from './contexts';
import { Home } from './pages';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <TitlebarProvider>
        <Home />
      </TitlebarProvider>
    </ThemeProvider>
  );
};

export default App;
