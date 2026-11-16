/**
 * Tests for the developer I/O image panel.
 *
 * The panel's whole value is that it is LIVE, so what is pinned here is that a
 * store change moves the numbers on screen. The sizer's arithmetic belongs to
 * `io-diagnostics.test.ts`; this asserts the wiring between the two.
 */

import { act, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

import { createOpenPLCStore, type OpenPLCStore, OpenPLCStoreProvider } from '@root/frontend/store'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PLCVariable } from '@root/middleware/shared/ports/types'
import { PlatformProvider } from '@root/middleware/shared/providers'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

import { DiagnosticsEditor } from '../index'

/** A port whose every method answers `undefined`. */
function stubPort<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_, prop) => (typeof prop === 'string' ? () => undefined : undefined),
  })
}

// The panel refuses to paint outside a dev build, so every case below has to
// say which build it is standing in.
function makePorts(isDevMode: boolean): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: { ...EDITOR_CAPABILITIES, isDevMode },
  }
}

let store: OpenPLCStore
let devMode = true
const getState = () => store.getState()

/** Render inside the store and the ports, which tests inject rather than mock. */
const renderPanel = () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpenPLCStoreProvider store={store}>
      <PlatformProvider ports={makePorts(devMode)}>{children}</PlatformProvider>
    </OpenPLCStoreProvider>
  )
  return render(<DiagnosticsEditor />, { wrapper })
}

const located = (name: string, location: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: 'INT' },
  location,
  documentation: '',
})

/** The row of the I/O image table for one `image.conf` key. */
const areaRow = (table: string) => screen.getByRole('cell', { name: table }).closest('tr')

const seedProgram = (variables: PLCVariable[]) => {
  getState().pouActions.create({ type: 'program', name: 'Main', language: 'st' })
  getState().projectActions.setPouVariables({ pouName: 'Main', variables })
}

/** A Modbus server exposing `mwCount` memory words. Memory needs a producer
 *  like every other area, so a `%MW` case needs one of these to be backed. */
const seedMemoryServer = (mwCount: number) => {
  // Server exposure is capability-scoped, and the capabilities are resolved
  // from `availableBoards.get(board)` rather than from the board name. With an
  // empty map the target runs no Modbus server, the exposure is discarded and
  // the area comes back absent, so both have to be seeded.
  getState().deviceActions.setAvailableOptions({
    availableBoards: new Map([['TestBoard', { compiler: 'arduino-cli' } as never]]),
  })
  getState().deviceActions.setDeviceBoard('TestBoard')
  if ((getState().project.data.servers ?? []).length === 0) {
    getState().projectActions.createServer({ data: { name: 'mb', protocol: 'modbus-tcp' } })
  }
  // `enabled` matters: a server created through the action starts disabled.
  getState().projectActions.updateServerConfig('mb', {
    enabled: true,
    bufferMapping: { holdingRegisters: { mwCount } },
  })
}

describe('DiagnosticsEditor', () => {
  beforeEach(() => {
    store = createOpenPLCStore()
    devMode = true
  })

  it('paints nothing in a production build, whoever renders it', () => {
    devMode = false
    seedProgram([located('scratch', '%MW4')])

    const { container } = renderPanel()

    expect(container.innerHTML).toBe('')
  })

  it('shows every table, including the ones nothing reaches', () => {
    renderPanel()

    expect(screen.getByRole('cell', { name: 'bool_input' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'bool_memory' })).toBeTruthy()
    expect(screen.getAllByRole('row')).not.toHaveLength(0)
  })

  it('sizes a memory area from the server exposure and names what sized it', () => {
    seedMemoryServer(5)
    seedProgram([located('scratch', '%MW4')])
    renderPanel()

    const row = areaRow('int_memory')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('5')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('modbus-server')).toBeTruthy()
  })

  it('reports a memory declaration with no producer, like any other area', () => {
    seedProgram([located('scratch', '%MW4')])
    renderPanel()

    expect(screen.getByText('nothing produces this address')).toBeTruthy()
  })

  it('recomputes when the exposure changes, without a remount', () => {
    seedMemoryServer(5)
    seedProgram([located('scratch', '%MW4')])
    renderPanel()

    act(() => {
      seedMemoryServer(41)
    })

    expect(within(areaRow('int_memory') as HTMLElement).getByText('41')).toBeTruthy()
  })

  it('reports a declaration the target cannot back', () => {
    seedProgram([located('sensor', '%IW0')])
    renderPanel()

    expect(screen.getByText('nothing produces this address')).toBeTruthy()
  })

  it('lists the located declarations with the slots each one claims', () => {
    seedMemoryServer(1)
    seedProgram([located('scratch', '%MW0'), located('sensor', '%IW0')])
    renderPanel()

    expect(screen.getByRole('cell', { name: 'scratch' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '%IW0' })).toBeTruthy()
  })

  it('renders the image.conf the build would write', () => {
    seedMemoryServer(2)
    seedProgram([located('scratch', '%MW1')])
    renderPanel()

    expect(screen.getByText(/int_memory=2 words/)).toBeTruthy()
  })

  it('collapses a section when its header is clicked', () => {
    renderPanel()

    expect(screen.getByRole('cell', { name: 'bool_input' })).toBeTruthy()
    act(() => {
      screen.getByRole('button', { name: /I\/O image/ }).click()
    })
    expect(screen.queryByRole('cell', { name: 'bool_input' })).toBeNull()
  })
})
