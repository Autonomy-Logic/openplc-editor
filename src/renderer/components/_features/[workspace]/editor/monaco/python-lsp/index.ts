import type * as monaco from 'monaco-editor'
import { MonacoPyrightProvider } from 'monaco-pyright-lsp'

let pyrightProvider: MonacoPyrightProvider | null = null

export async function initPythonLSP(monacoModule: typeof monaco): Promise<void> {
  if (pyrightProvider) {
    return
  }

  try {
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

    await pyrightProvider.init(monacoModule)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Failed to initialize Python LSP:', errorMessage)
  }
}

export async function setupPythonLSPForEditor(editor: monaco.editor.IStandaloneCodeEditor): Promise<void> {
  if (!pyrightProvider) {
    console.warn('Python LSP not initialized')
    return
  }

  try {
    await pyrightProvider.setupDiagnostics(editor)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Failed to setup Python LSP diagnostics:', errorMessage)
  }
}

export function cleanupPythonLSP(): void {
  if (pyrightProvider) {
    void pyrightProvider.stopDiagnostics()
  }
}
