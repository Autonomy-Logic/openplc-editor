import { createOpenPLCStore } from './frontend/store'
import { createEditorPorts } from './middleware/editor-platform'

// The one place the app's store and ports are instantiated; everything below receives them.
export const appStore = createOpenPLCStore()
export const editorPorts = createEditorPorts(appStore)
