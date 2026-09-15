/**
 * @jest-environment jsdom
 */
import type * as monaco from 'monaco-editor'

import { createLspDocumentMirror, lspMirrorUri, parseLspMirrorUri } from '../lsp-mirror'

describe('lspMirrorUri / parseLspMirrorUri', () => {
  it.each([
    'inmemory://pou/main.st',
    'inmemory://stub/Ladder.st',
    'inmemory://datatypes/__project__.st',
    'inmemory://globals/__resource__.st',
    'file:///projects/p1/MyPou.py',
  ])('round-trips %s', (lspUri) => {
    const mirrored = lspMirrorUri(lspUri)
    expect(mirrored.startsWith('inmemory://lsp-mirror/')).toBe(true)
    expect(parseLspMirrorUri(mirrored)).toBe(lspUri)
  })

  it('keeps the document extension so the preview colours by it', () => {
    expect(lspMirrorUri('inmemory://pou/main.st').endsWith('.st')).toBe(true)
    expect(lspMirrorUri('file:///MyPou.py').endsWith('.py')).toBe(true)
  })

  it('returns null for anything that is not a mirror URI', () => {
    expect(parseLspMirrorUri('inmemory://pou/main.st')).toBeNull()
    expect(parseLspMirrorUri('inmemory://lsp-mirror/')).toBeNull()
    expect(parseLspMirrorUri('inmemory://lsp-mirror/nopath')).toBeNull()
  })
})

describe('createLspDocumentMirror', () => {
  function makeMonacoStub() {
    const models = new Map<string, { uri: string; language: string; value: string; disposed: boolean }>()
    const api = {
      Uri: { parse: (s: string) => ({ toString: () => s }) },
      editor: {
        getModel: (uri: { toString(): string }) => {
          const m = models.get(uri.toString())
          return m && !m.disposed ? asModel(m) : null
        },
        createModel: (value: string, language: string, uri: { toString(): string }) => {
          const m = { uri: uri.toString(), language, value, disposed: false }
          models.set(m.uri, m)
          return asModel(m)
        },
      },
    } as unknown as typeof monaco
    function asModel(m: { uri: string; language: string; value: string; disposed: boolean }) {
      return {
        uri: { toString: () => m.uri },
        getValue: () => m.value,
        setValue: (v: string) => {
          m.value = v
        },
        dispose: () => {
          m.disposed = true
        },
      } as unknown as monaco.editor.ITextModel
    }
    return { api, models }
  }

  it('creates a plaintext model at the mirror URI on first set and updates it on change', () => {
    const { api, models } = makeMonacoStub()
    const mirror = createLspDocumentMirror(api)

    mirror.set('inmemory://pou/main.st', 'PROGRAM main')
    mirror.set('inmemory://pou/main.st', 'PROGRAM main\nx := 1;')

    const model = models.get(lspMirrorUri('inmemory://pou/main.st'))
    expect(model).toMatchObject({ language: 'plaintext', value: 'PROGRAM main\nx := 1;' })
    expect(models.size).toBe(1)
  })

  it('adopts a model that already exists at the mirror URI', () => {
    const { api, models } = makeMonacoStub()
    api.editor.createModel('stale', 'plaintext', api.Uri.parse(lspMirrorUri('inmemory://pou/main.st')))
    const mirror = createLspDocumentMirror(api)

    mirror.set('inmemory://pou/main.st', 'fresh')

    expect(models.size).toBe(1)
    expect(models.get(lspMirrorUri('inmemory://pou/main.st'))?.value).toBe('fresh')
  })

  it('disposes a document on delete and everything on dispose', () => {
    const { api, models } = makeMonacoStub()
    const mirror = createLspDocumentMirror(api)
    mirror.set('inmemory://pou/a.st', 'A')
    mirror.set('inmemory://pou/b.st', 'B')

    mirror.delete('inmemory://pou/a.st')
    expect(models.get(lspMirrorUri('inmemory://pou/a.st'))?.disposed).toBe(true)
    expect(models.get(lspMirrorUri('inmemory://pou/b.st'))?.disposed).toBe(false)

    mirror.dispose()
    expect(models.get(lspMirrorUri('inmemory://pou/b.st'))?.disposed).toBe(true)
  })
})
