import './frontend/locales/i18n'

import { createRoot } from 'react-dom/client'

import App from './App'
import { installMonacoCancellationGuard } from './frontend/utils/ignore-monaco-cancellations'

installMonacoCancellationGuard()

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)
root.render(<App />)

postMessage({ payload: 'removeLoading' }, '*')
