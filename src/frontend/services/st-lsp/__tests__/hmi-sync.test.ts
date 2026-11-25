/**
 * @jest-environment jsdom
 */
import type { HmiPreviewPort } from '../../../../middleware/shared/ports/hmi-preview-port'
import type { HmiCodeContext } from '../../../../middleware/shared/ports/hmi-preview-types'
import type { OpenPLCStore } from '../../../store'
import { createTestStore } from '../../../store/testing'
import { getBodyLineOffset } from '../../lsp-shared/body-offsets'
import { hmiFileUri } from '../../hmi-code/uris'
import { attachHmiSync, HMI_GLUE_URI, HMI_INSTANCE_PATHS_PRAGMA } from '../hmi-sync'
import type { StLspService } from '../types'

const opened: Array<[string, string]> = []
const changed: Array<[string, string]> = []
const closed: string[] = []
const service: StLspService = {
  ready: Promise.resolve(),
  refreshStlibs: () => Promise.resolve(),
  openDocument: (uri, text) => void opened.push([uri, text]),
  changeDocument: (uri, text) => void changed.push([uri, text]),
  closeDocument: (uri) => void closed.push(uri),
  dispose: () => undefined,
}
const CONTEXT: HmiCodeContext = {
  libraries: [{ name: 'StandardWidgets', archiveJson: '{"manifest":{}}' }],
  glue: 'TYPE HMI_SCREEN : (Overview := 0); END_TYPE\n',
  screenMembers: ['LAYOUT'],
}
/** A preview port that answers only what the sync asks for. */
function previewPort(): HmiPreviewPort {
  const unused = () => Promise.reject(new Error('not used'))
  return {
    build: unused,
    catalog: unused,
    thumbnails: unused,
    codeContext: (sources) =>
      Promise.resolve({
        ...CONTEXT,
        glue: sources.screens.length > 0 ? CONTEXT.glue : '',
        screenMembers: sources.libraries.includes('gauges')
          ? [...CONTEXT.screenMembers, 'DIAL']
          : CONTEXT.screenMembers,
      }),
    openSession: () => {
      throw new Error('not used')
    },
    holdToolchain: () => Promise.resolve(),
  }
}

let store: OpenPLCStore
let reloads = 0
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  opened.length = 0
  changed.length = 0
  closed.length = 0
  reloads = 0
  store = createTestStore()
})

function attach() {
  return attachHmiSync(store, service, previewPort(), () => {
    reloads++
    return Promise.resolve()
  })
}

describe('HMI sync into the ST language server', () => {
  it('stays out of the way while the project has no HMI file', async () => {
    const sync = attach()
    await flush()
    expect(opened).toEqual([])
    expect(reloads).toBe(0)
    expect(await sync.libraries()).toEqual([])
    sync.dispose()
  })

  it('opens screens marked for instance paths, the navigation declarations and the libraries', async () => {
    const sync = attach()
    store.getState().hmiActions.create('screen', 'Overview')
    await flush()
    const uri = hmiFileUri('screen', 'Overview')
    const source = store.getState().project.data.hmi?.screens[0].source ?? ''
    expect(opened).toContainEqual([uri, `${HMI_INSTANCE_PATHS_PRAGMA}\n${source}`])
    expect(opened).toContainEqual([HMI_GLUE_URI, CONTEXT.glue])
    expect(getBodyLineOffset(uri)).toBe(1)
    expect(reloads).toBe(1)
    expect(await sync.libraries()).toEqual([
      { sourceLabel: 'StandardWidgets', payload: CONTEXT.libraries[0].archiveJson },
    ])
    expect([...sync.screenMembers()]).toEqual(['LAYOUT'])

    store.getState().hmiDesignerActions.applySource('screen', 'Overview', `${source}(* edit *)\n`)
    await flush()
    expect(changed).toContainEqual([uri, `${HMI_INSTANCE_PATHS_PRAGMA}\n${source}(* edit *)\n`])
    sync.dispose()
    expect(closed).toEqual(expect.arrayContaining([uri, HMI_GLUE_URI]))
  })

  it('updates the screen members when the project lists a library, without an HMI edit', async () => {
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
    const sync = attach()
    store.getState().hmiActions.create('screen', 'Overview')
    await flush()
    expect([...sync.screenMembers()]).toEqual(['LAYOUT'])
    const hmi = store.getState().project.data.hmi

    store.getState().libraryActions.enableLibrary('gauges')
    await flush()
    expect(store.getState().project.data.hmi).toBe(hmi)
    expect([...sync.screenMembers()]).toEqual(['LAYOUT', 'DIAL'])
    sync.dispose()
  })
})
