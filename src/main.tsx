import '@/styles/tailwind.css';
import '@/styles/react-resizable.css';
import '@/styles/titlebar.css';
import '@shared/i18n';
import '@/utils/string.extension';

import React from 'react';
import ReactDOM from 'react-dom/client';

import App from '@/App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

postMessage({ payload: 'removeLoading' }, '*');
