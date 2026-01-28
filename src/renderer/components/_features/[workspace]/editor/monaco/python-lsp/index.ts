import type * as monaco from 'monaco-editor'
import { MonacoPyrightProvider } from 'monaco-pyright-lsp'

let pyrightProvider: MonacoPyrightProvider | null = null

export async function initPythonLSP(monacoModule: typeof monaco): Promise<void> {
  if (pyrightProvider) {
    return
  }

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
}

export async function setupPythonLSPForEditor(editor: monaco.editor.IStandaloneCodeEditor): Promise<void> {
  if (!pyrightProvider) {
    return
  }

  await pyrightProvider.setupDiagnostics(editor)
}

export function cleanupPythonLSP(): void {
  if (pyrightProvider) {
    void pyrightProvider.stopDiagnostics()
    pyrightProvider = null
  }
}
