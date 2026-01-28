import type * as monaco from 'monaco-editor'
import { MonacoPyrightProvider } from 'monaco-pyright-lsp'

let pyrightProvider: MonacoPyrightProvider | null = null
let isInitializing = false

export async function initPythonLSP(monacoModule: typeof monaco): Promise<void> {
  if (pyrightProvider || isInitializing) {
    return
  }

  isInitializing = true

  try {
    pyrightProvider = new MonacoPyrightProvider(undefined, {
      features: {
        hover: true,
        completion: true,
        signatureHelp: false,
        diagnostic: true,
        rename: false,
        findDefinition: false,
      },
      diagnosticsInterval: 1000,
    })

    await pyrightProvider.init(monacoModule)
  } finally {
    isInitializing = false
  }
}

export async function setupPythonLSPForEditor(editor: monaco.editor.IStandaloneCodeEditor): Promise<void> {
  if (!pyrightProvider) {
    return
  }

  try {
    await pyrightProvider.setupDiagnostics(editor)
  } catch (error) {
    // The library can throw if the internal LSP client isn't ready yet.
    // This is a known race condition in monaco-pyright-lsp.
    console.warn('[Python LSP] setupDiagnostics failed, will retry on next editor focus:', error)
  }
}

export function cleanupPythonLSP(): void {
  const provider = pyrightProvider
  pyrightProvider = null

  if (provider) {
    // Fire and forget - don't block on cleanup
    provider.stopDiagnostics().catch(() => {
      // Ignore cleanup errors
    })
  }
}
