import '@/styles/index.css'
import '@shared/i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

postMessage({ payload: 'removeLoading' }, '*')
