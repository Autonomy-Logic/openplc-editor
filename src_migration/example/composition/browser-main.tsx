// Browser entry point, loaded by index.html. Nothing from the current app's bootstrap is involved.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createBrowserVariableListApp } from './create-variable-list-app'
import { VariableListRoot } from './variable-list-root'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// Created outside React, once per page, so StrictMode double rendering never creates a second instance.
const app = createBrowserVariableListApp(window.localStorage)

createRoot(container).render(
  <StrictMode>
    <VariableListRoot controller={app.controller} />
  </StrictMode>,
)

// `start` never rejects; a load failure is shown through the model's status line.
void app.start()
