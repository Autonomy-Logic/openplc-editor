import type * as monaco from 'monaco-editor'
import { MonacoPyrightProvider } from 'monaco-pyright-lsp'

let pyrightProvider: MonacoPyrightProvider | null = null

export async function initPythonLSP(monacoModule: typeof monaco): Promise<void> {
  console.log('[Python LSP] initPythonLSP called, provider exists:', !!pyrightProvider)

  if (pyrightProvider) {
    console.log('[Python LSP] Provider already initialized, skipping')
    return
  }

  try {
    console.log('[Python LSP] Creating MonacoPyrightProvider...')
    pyrightProvider = new MonacoPyrightProvider(undefined, {
      features: {
        hover: true,
        completion: true,
        signatureHelp: false,
        diagnostic: true,
        rename: false,
        findDefinition: true,
      },
      diagnosticsInterval: 1000,
    })
    console.log('[Python LSP] MonacoPyrightProvider created successfully')

    console.log('[Python LSP] Initializing provider with Monaco...')
    await pyrightProvider.init(monacoModule)
    console.log('[Python LSP] Provider initialized successfully')
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error('[Python LSP] Failed to initialize:', errorMessage)
    if (errorStack) {
      console.error('[Python LSP] Stack trace:', errorStack)
    }
    throw error
  }
}

export async function setupPythonLSPForEditor(editor: monaco.editor.IStandaloneCodeEditor): Promise<void> {
  console.log('[Python LSP] setupPythonLSPForEditor called, provider exists:', !!pyrightProvider)

  if (!pyrightProvider) {
    console.warn('[Python LSP] Provider not initialized, cannot setup diagnostics')
    return
  }

  try {
    const model = editor.getModel()
    console.log('[Python LSP] Setting up diagnostics for editor, model language:', model?.getLanguageId())
    await pyrightProvider.setupDiagnostics(editor)
    console.log('[Python LSP] Diagnostics setup complete')
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error('[Python LSP] Failed to setup diagnostics:', errorMessage)
    if (errorStack) {
      console.error('[Python LSP] Stack trace:', errorStack)
    }
    throw error
  }
}

export function cleanupPythonLSP(): void {
  console.log('[Python LSP] cleanupPythonLSP called, provider exists:', !!pyrightProvider)
  if (pyrightProvider) {
    console.log('[Python LSP] Stopping diagnostics...')
    void pyrightProvider.stopDiagnostics()
    console.log('[Python LSP] Diagnostics stopped')
  }
}
