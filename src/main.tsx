import '@/styles/index.css'
import '@shared/i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'

/**
 * Represents the root element where the app will be rendered.
 * Renders the app into the root element wrapped in React's StrictMode.
 * @param {React.ReactNode} children - The content to be rendered inside StrictMode.
 * @type {HTMLElement}
 */
createRoot(document.getElementById('root') as HTMLElement).render(
  /**
   * Wraps the app with React's StrictMode for enhanced development warnings.
   * @type {React.ReactNode}
   */
  <StrictMode>
    <App />
  </StrictMode>,
)
/**
 * Sends a message to the parent frame to remove loading state.
 * @param {any} data - The data to be sent in the postMessage.
 */
postMessage({ payload: 'removeLoading' }, '*')
