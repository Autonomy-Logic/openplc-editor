/**
 * @jest-environment jsdom
 */
import { type OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { cleanup, render, screen } from '@testing-library/react'

import { HmiSettingsEditor } from '../settings-editor'

const BOARD_NAME = 'Panel Board'
const PANEL = { width: 800, height: 480, density: 1, touch: true, colorFormat: 'rgb565' } as const

let store: OpenPLCStore

function renderWithBoard(board: BoardInfo) {
  store = createTestStore()
  store.getState().hmiActions.create('screen', 'Overview')
  const { deviceActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD_NAME, board]]) })
  deviceActions.setDeviceBoard(BOARD_NAME)
  const ports = createTestPorts({ capabilities: EDITOR_CAPABILITIES })
  render(<HmiSettingsEditor />, { wrapper: createStoreWrapper(store, ports) })
}

afterEach(cleanup)

describe('HmiSettingsEditor — Local panel', () => {
  it('shows the panel options on a board that declares a panel', () => {
    renderWithBoard({
      compiler: 'arduino-cli',
      core: 'arduino:avr',
      preview: 'board.png',
      specs: {},
      capabilities: { hmi: PANEL },
    })
    expect(screen.getByRole('checkbox', { name: 'Require a PIN' })).toBeTruthy()
    expect(screen.getByTestId('hmi-relock')).toBeTruthy()
    expect(screen.queryByTestId('hmi-local-panel-none')).toBeNull()
    expect(screen.queryByTestId('hmi-touch-calibration')).toBeNull()
  })

  it('offers when to calibrate the touch only on a panel whose touch needs it', () => {
    renderWithBoard({
      compiler: 'arduino-cli',
      core: 'esp32:esp32',
      preview: 'board.png',
      specs: {},
      capabilities: { hmi: { ...PANEL, touchCalibration: true } },
    })
    expect(screen.getByTestId('hmi-touch-calibration').textContent).toContain('Once')
  })

  it('says the board has no panel, and offers no panel options, on a board without one', () => {
    renderWithBoard({ compiler: 'arduino-cli', core: 'arduino:avr', preview: 'board.png', specs: {} })
    expect(screen.getByTestId('hmi-local-panel-none').textContent).toBe('The selected board has no local panel.')
    expect(screen.queryByRole('checkbox', { name: 'Require a PIN' })).toBeNull()
    expect(screen.queryByTestId('hmi-relock')).toBeNull()
  })
})
