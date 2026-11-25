/**
 * @jest-environment jsdom
 */
import type * as monaco from 'monaco-editor'

import type { HmiPreviewPort } from '../../../../middleware/shared/ports/hmi-preview-port'
import type { HmiWidgetInfo } from '../../../../middleware/shared/ports/hmi-preview-types'
import { newHmiScreenSource } from '../../../../middleware/shared/utils/hmi/project-files'
import { createTestStore } from '../../../store/testing'
import { attachHmiCodeAssist, type HmiAssistModel, type HmiAssistMonaco } from '../assist'
import { hmiFileUri } from '../uris'

const widget = (name: string, library: string): HmiWidgetInfo => ({
  name,
  library,
  extends: 'HmiElement',
  properties: [],
  outputs: [],
  events: [],
})

/** A preview port whose catalogue has one widget, `HmiGauge`, only while the project uses the `gauges` library. */
function previewPort(): HmiPreviewPort {
  const unused = () => Promise.reject(new Error('not used'))
  return {
    build: unused,
    thumbnails: unused,
    codeContext: unused,
    catalog: (_widgets, libraries) =>
      Promise.resolve({
        catalog: {
          widgets: new Map(libraries.includes('gauges') ? [['HMIGAUGE', widget('HmiGauge', 'gauges')]] : []),
          colors: [],
        },
        errors: [],
      }),
    openSession: () => {
      throw new Error('not used')
    },
    holdToolchain: () => Promise.resolve(),
  }
}

/** A text model over `text` at `uri`. */
function textModel(uri: string, text: string): HmiAssistModel {
  const position = (offset: number): monaco.Position => {
    const before = text.slice(0, offset).split('\n')
    const lineNumber = before.length
    const column = before[before.length - 1].length + 1
    return {
      lineNumber,
      column,
      with: () => position(offset),
      delta: () => position(offset),
      equals: () => false,
      isBefore: () => false,
      isBeforeOrEqual: () => false,
      clone: () => position(offset),
      toJSON: () => ({ lineNumber, column }),
    }
  }
  return {
    uri: { toString: () => uri },
    getValue: () => text,
    isDisposed: () => false,
    getPositionAt: position,
    getOffsetAt: () => 0,
    getLineContent: (line) => text.split('\n')[line - 1] ?? '',
  }
}

describe('HMI code assist', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('marks a screen again when the project lists a library, without an HMI edit', async () => {
    const store = createTestStore()
    store.getState().libraryActions.applyInstalledLibraries(
      [
        {
          manifest: {
            name: 'gauges',
            version: '1.0.0',
            namespace: 'gauges',
            isBuiltin: false,
            functions: [],
            functionBlocks: [],
            types: [],
          },
        },
      ],
      [{ name: 'gauges', bundled: false }],
    )
    store.getState().hmiActions.create('screen', 'Overview')
    const source = newHmiScreenSource('Overview').replace('  END_VAR', '    Layout : HmiGauge;\n  END_VAR')
    const model = textModel(hmiFileUri('screen', 'Overview'), source)
    const markers: monaco.editor.IMarkerData[][] = []
    const api: HmiAssistMonaco = {
      editor: {
        getModels: () => [model],
        setModelMarkers: (_model, _owner, list) => void markers.push(list),
        onDidCreateModel: () => ({ dispose: () => undefined }),
      },
      languages: {
        registerCompletionItemProvider: () => ({ dispose: () => undefined }),
        CompletionItemKind: { Property: 9, EnumMember: 16, Reference: 21, Color: 19 },
      },
      MarkerSeverity: { Error: 8 },
    }
    const assist = attachHmiCodeAssist({
      store,
      preview: previewPort(),
      monaco: api,
      screenMembers: () => new Set(['LAYOUT']),
    })
    await jest.runAllTimersAsync()
    expect(markers.at(-1)).toEqual([])
    const hmi = store.getState().project.data.hmi

    store.getState().libraryActions.enableLibrary('gauges')
    await jest.runAllTimersAsync()
    expect(store.getState().project.data.hmi).toBe(hmi)
    expect(markers.at(-1)?.map((m) => m.message)).toContain(
      'Layout: an element may not be named like a member of HmiScreen',
    )
    assist.dispose()
  })
})
