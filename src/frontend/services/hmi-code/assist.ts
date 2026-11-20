/**
 * What the HMI code view adds to the ST language service for screens and widget blocks: the HMI rules the compiler
 * does not check, marked where they are, and completions for element initializers, Parent, Source, Target and the
 * theme pragma.
 */
import type * as monaco from 'monaco-editor'

import type { HmiPreviewPort } from '../../../middleware/shared/ports/hmi-preview-port'
import { checkHmiBlock, type HmiCheckBlock, type HmiCheckSpan } from '../../../middleware/shared/utils/hmi/block-checks'
import { type HmiAssistItem, hmiCompletions } from '../../../middleware/shared/utils/hmi/code-assist'
import { type DesignerModel, parseDesignerBlock } from '../../../middleware/shared/utils/hmi/designer/designer-model'
import { defaultHmiSettings } from '../../../middleware/shared/utils/hmi/settings'
import { projectLibraryNames } from '../../../middleware/shared/utils/library/project-libraries'
import type { OpenPLCStore } from '../../store'
import { parseHmiFileUri } from './uris'

const MARKER_OWNER = 'hmi-checks'
const CHECK_DELAY_MS = 250

export interface HmiCodeAssistOptions {
  store: OpenPLCStore
  preview: HmiPreviewPort
  monaco: typeof monaco
  /** Upper-case members of HmiScreen, which elements may not reuse. */
  screenMembers: () => ReadonlySet<string>
}

/** What the shared checks read from the designer's model of a file. */
const checkBlockOf = (model: DesignerModel): HmiCheckBlock => ({
  name: model.name,
  extends: model.extends,
  theme: model.theme,
  methods: model.methods,
  elements: model.elements,
  nameSpan: model.nameSpan,
  ...(model.themeLines ? { themeSpan: model.themeLines } : {}),
})

const COMPLETION_KINDS: Record<HmiAssistItem['kind'], keyof typeof monaco.languages.CompletionItemKind> = {
  property: 'Property',
  value: 'EnumMember',
  element: 'Reference',
  theme: 'Color',
}

export function attachHmiCodeAssist(options: HmiCodeAssistOptions): { dispose(): void } {
  const { store, preview, monaco: api } = options
  const hmi = () => store.getState().project.data.hmi
  const catalogNow = async () => {
    const { bundledLibraryNames, enabledLibraries } = store.getState()
    return (await preview.catalog(hmi()?.widgets ?? [], projectLibraryNames(bundledLibraryNames, enabledLibraries)))
      .catalog
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const markAll = async (): Promise<void> => {
    const models = api.editor.getModels().filter((m) => parseHmiFileUri(m.uri.toString()) !== null)
    if (models.length === 0) return
    const catalog = await catalogNow()
    const settings = hmi()?.settings ?? defaultHmiSettings()
    for (const model of models) {
      const file = parseHmiFileUri(model.uri.toString())
      if (disposed || !file || model.isDisposed()) continue
      const parsed = parseDesignerBlock(model.getValue(), (t) => catalog.widgets.has(t.toUpperCase()))
      if (!parsed.ok) {
        api.editor.setModelMarkers(model, MARKER_OWNER, [])
        continue
      }
      const findings = checkHmiBlock(checkBlockOf(parsed.model), {
        kind: file.kind,
        fileName: file.name,
        catalog,
        settings,
        screenMembers: options.screenMembers(),
      })
      const marker = (message: string, span: HmiCheckSpan): monaco.editor.IMarkerData => {
        const start = model.getPositionAt(span.start)
        const end = model.getPositionAt(Math.max(span.end, span.start + 1))
        return {
          severity: api.MarkerSeverity.Error,
          message,
          source: 'HMI',
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        }
      }
      api.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        findings.map((f) => marker(f.message, f.span ?? parsed.model.nameSpan)),
      )
    }
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!disposed) void markAll().catch((error: unknown) => console.warn('[hmi-code] checks failed:', error))
    }, CHECK_DELAY_MS)
  }

  const unsubscribe = store.subscribe((s) => s.project.data.hmi, schedule)
  const created = api.editor.onDidCreateModel((model) => {
    if (parseHmiFileUri(model.uri.toString()) !== null) schedule()
  })
  const completions = api.languages.registerCompletionItemProvider('st', {
    triggerCharacters: ['(', ',', "'", ' '],
    async provideCompletionItems(model, position) {
      if (parseHmiFileUri(model.uri.toString()) === null) return { suggestions: [] }
      const catalog = await catalogNow()
      const settings = hmi()?.settings ?? defaultHmiSettings()
      const items = hmiCompletions(model.getValue(), model.getOffsetAt(position), catalog, settings)
      if (!items) return { suggestions: [] }
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
      const typed = /[\w#.]*$/.exec(before)?.[0] ?? ''
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column - typed.length,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }
      return {
        suggestions: items.map((item, i) => ({
          label: item.label,
          insertText: item.insertText,
          kind: api.languages.CompletionItemKind[COMPLETION_KINDS[item.kind]],
          range,
          sortText: String(i).padStart(4, '0'),
          ...(item.detail ? { detail: item.detail } : {}),
          ...(item.documentation ? { documentation: item.documentation } : {}),
        })),
      }
    },
  })
  schedule()

  return {
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      created.dispose()
      completions.dispose()
    },
  }
}
