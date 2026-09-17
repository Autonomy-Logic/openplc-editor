/**
 * Tests for the developer I/O image panel.
 *
 * The panel's whole value is that it is LIVE, so what is pinned here is that a
 * store change moves the numbers on screen. The sizer's arithmetic belongs to
 * `io-diagnostics.test.ts`; this asserts the wiring between the two.
 */

import { act, render, screen, within } from '@testing-library/react'

// The panel refuses to paint outside a dev build, so every case below has to
// say which build it is standing in.
let isDevMode = true
jest.mock('@root/middleware/shared/providers', () => ({
  useCapabilities: () => ({ isDevMode }),
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

describe('DiagnosticsEditor', () => {
  beforeEach(() => {
    isDevMode = true
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('paints nothing in a production build, whoever renders it', () => {
    isDevMode = false
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

  it('sizes a memory area from a declaration and names what sized it', () => {
    seedProgram([located('scratch', '%MW4')])
    render(<DiagnosticsEditor />)

    const row = areaRow('int_memory')
    expect(row).not.toBeNull()
    // `%MW4` is slot 4, so the area needs five words.
    expect(within(row as HTMLElement).getByText('5')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('declarations')).toBeTruthy()
  })

  it('recomputes when a declaration changes, without a remount', () => {
    seedProgram([located('scratch', '%MW4')])
    render(<DiagnosticsEditor />)

    act(() => {
      getState().projectActions.setPouVariables({
        pouName: 'Main',
        variables: [located('scratch', '%MW40')],
      })
    })

    expect(within(areaRow('int_memory') as HTMLElement).getByText('41')).toBeTruthy()
  })

  it('reports a declaration the target cannot back', () => {
    seedProgram([located('sensor', '%IW0')])
    render(<DiagnosticsEditor />)

    expect(screen.getByText('nothing produces this address')).toBeTruthy()
  })

  it('lists the located declarations with the slots each one claims', () => {
    seedProgram([located('scratch', '%MW0'), located('sensor', '%IW0')])
    render(<DiagnosticsEditor />)

    expect(screen.getByRole('cell', { name: 'scratch' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '%IW0' })).toBeTruthy()
  })

  it('renders the image.conf the build would write', () => {
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
