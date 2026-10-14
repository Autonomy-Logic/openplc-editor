/**
 * The native File > Export to PLCopen XML item reaches the same action the React menubar
 * runs, so both menus share one generator call and one save dialog.
 */

import { act, render } from '@testing-library/react'
import type { AcceleratorPort } from '../../../../middleware/shared/ports/accelerator-port'
import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import type { OpenPLCStore } from '../../../store'
import { createStoreWrapper, createTestStore } from '../../../store/testing'
import { AcceleratorHandler } from '../accelerator-handler'

const listeners = new Map<string, () => void>()
const exportCalls: Array<[string, string]> = []

function stubPort<T extends object>(): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => (typeof prop === 'string' ? () => undefined : undefined),
  })
}

const accelerator = new Proxy<AcceleratorPort>(Object.create(null), {
  get: (_, prop) =>
    typeof prop === 'string'
      ? (callback: () => void) => {
          listeners.set(prop, callback)
          return () => {
            if (listeners.get(prop) === callback) listeners.delete(prop)
          }
        }
      : undefined,
})

/** Only the save step is observed; the generator runs for real on the test store. */
const projectPort = new Proxy<PlatformPorts['project']>(Object.create(null), {
  get: (_, prop) => {
    if (prop === 'exportPlcopenFile') {
      return (fileName: string, xml: string) => {
        exportCalls.push([fileName, xml])
        return Promise.resolve({ success: true })
      }
    }
    return typeof prop === 'string' ? () => undefined : undefined
  },
})

function makePorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: projectPort,
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator,
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
  }
}

let store: OpenPLCStore

function renderHandler() {
  return render(<AcceleratorHandler />, { wrapper: createStoreWrapper(store, makePorts()) })
}

function fireExport() {
  const callback = listeners.get('onExportProject')
  if (!callback) throw new Error('nothing subscribed to onExportProject')
  act(() => callback())
}

beforeEach(() => {
  store = createTestStore()
  listeners.clear()
  exportCalls.length = 0
})

describe('Export to PLCopen XML from the native menu', () => {
  it('generates the PLCopen XML and saves it through the project port', async () => {
    act(() => store.getState().projectActions.updateMetaPath('/projects/demo'))
    renderHandler()

    fireExport()
    await act(async () => {})

    expect(exportCalls).toHaveLength(1)
    const [fileName, xml] = exportCalls[0]
    expect(fileName).toBe(`${store.getState().project.meta.name}.xml`)
    expect(xml).toContain('<project')
  })

  it('ignores the request on the start screen', async () => {
    renderHandler()

    fireExport()
    await act(async () => {})

    expect(exportCalls).toHaveLength(0)
  })
})
