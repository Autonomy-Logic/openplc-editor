/**
 * Tests for the developer I/O image panel.
 *
 * The panel's whole value is that it is LIVE, so what is pinned here is that a
 * store change moves the numbers on screen. The sizer's arithmetic belongs to
 * `io-diagnostics.test.ts`; this asserts the wiring between the two.
 */

import { act, render, screen, within } from '@testing-library/react'

// The panel refuses to paint outside a dev build, so every case below has to
// say which build it is standing in. `mock`-prefixed because the factory closes
// over it and both runners' hoisting rules key off that prefix.
let mockIsDevMode = true
jest.mock('@root/middleware/shared/providers', () => ({
  useCapabilities: () => ({ isDevMode: mockIsDevMode }),
}))

import { useOpenPLCStore } from '@root/frontend/store'
import type { PLCVariable } from '@root/middleware/shared/ports/types'

import { DiagnosticsEditor } from '../index'

const getState = () => useOpenPLCStore.getState()

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
  if ((getState().project.data.servers ?? []).length === 0) {
    getState().projectActions.createServer({ data: { name: 'mb', protocol: 'modbus-tcp' } })
  }
  getState().projectActions.updateServerConfig('mb', { bufferMapping: { holdingRegisters: { mwCount } } })
}

describe('DiagnosticsEditor', () => {
  beforeEach(() => {
    mockIsDevMode = true
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('paints nothing in a production build, whoever renders it', () => {
    mockIsDevMode = false
    seedProgram([located('scratch', '%MW4')])

    const { container } = render(<DiagnosticsEditor />)

    expect(container.innerHTML).toBe('')
  })

  it('shows every table, including the ones nothing reaches', () => {
    render(<DiagnosticsEditor />)

    expect(screen.getByRole('cell', { name: 'bool_input' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'bool_memory' })).toBeTruthy()
    expect(screen.getAllByRole('row')).not.toHaveLength(0)
  })

  it('sizes a memory area from the server exposure and names what sized it', () => {
    seedMemoryServer(5)
    seedProgram([located('scratch', '%MW4')])
    render(<DiagnosticsEditor />)

    const row = areaRow('int_memory')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('5')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('modbus-server')).toBeTruthy()
  })

  it('reports a memory declaration with no producer, like any other area', () => {
    seedProgram([located('scratch', '%MW4')])
    render(<DiagnosticsEditor />)

    expect(screen.getByText('nothing produces this address')).toBeTruthy()
  })

  it('recomputes when the exposure changes, without a remount', () => {
    seedMemoryServer(5)
    seedProgram([located('scratch', '%MW4')])
    render(<DiagnosticsEditor />)

    act(() => {
      seedMemoryServer(41)
    })

    expect(within(areaRow('int_memory') as HTMLElement).getByText('41')).toBeTruthy()
  })

  it('reports a declaration the target cannot back', () => {
    seedProgram([located('sensor', '%IW0')])
    render(<DiagnosticsEditor />)

    expect(screen.getByText('nothing produces this address')).toBeTruthy()
  })

  it('lists the located declarations with the slots each one claims', () => {
    seedMemoryServer(1)
    seedProgram([located('scratch', '%MW0'), located('sensor', '%IW0')])
    render(<DiagnosticsEditor />)

    expect(screen.getByRole('cell', { name: 'scratch' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '%IW0' })).toBeTruthy()
  })

  it('renders the image.conf the build would write', () => {
    seedMemoryServer(2)
    seedProgram([located('scratch', '%MW1')])
    render(<DiagnosticsEditor />)

    expect(screen.getByText(/int_memory=2 words/)).toBeTruthy()
  })

  it('collapses a section when its header is clicked', () => {
    render(<DiagnosticsEditor />)

    expect(screen.getByRole('cell', { name: 'bool_input' })).toBeTruthy()
    act(() => {
      screen.getByRole('button', { name: /I\/O image/ }).click()
    })
    expect(screen.queryByRole('cell', { name: 'bool_input' })).toBeNull()
  })
})
