import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '../../../../../../store'
import { CreateServerEditor } from '../../../../../../store/slices/tabs/utils'
import { ModbusServerEditor } from '../modbus-server'
import { S7CommServerEditor } from '../s7comm-server'

const BOARD = 'Runtime v4'

const board: BoardInfo = {
  compiler: 'openplc-compiler',
  core: '',
  preview: '',
  specs: {},
  capabilities: { modbusTcpServer: true, s7Server: true },
}

let store: OpenPLCStore

const seedBoard = () => {
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD, board]]) })
  store.getState().deviceActions.setDeviceBoard(BOARD)
}

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

describe('Modbus server editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    seedBoard()
    expect(
      store.getState().projectActions.createServer({
        data: { name: 'MB1', protocol: 'modbus-tcp', modbusSlaveConfig: { enabled: true, transports: ['tcp'], networkInterface: '0.0.0.0', port: 502 } },
      }).ok,
    ).toBe(true)
    store.getState().editorActions.setEditor(CreateServerEditor('MB1', 'modbus-tcp'))
    render(<ModbusServerEditor />, { wrapper: createStoreWrapper(store) })
  })

  const portField = () => screen.getByLabelText<HTMLInputElement>('Port')

  it('should leave the TCP port editable while no debug session is open', () => {
    expect(portField().matches(':disabled')).toBe(false)
  })

  it('should lock the TCP port while the debugger is open', () => {
    openDebugSession()

    expect(portField().matches(':disabled')).toBe(true)
  })

  it('should release the TCP port once the debug session is closed', () => {
    openDebugSession()
    closeDebugSession()

    expect(portField().matches(':disabled')).toBe(false)
  })
})

describe('S7comm server editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    seedBoard()
    expect(store.getState().projectActions.createServer({ data: { name: 'S71', protocol: 's7comm' } }).ok).toBe(true)
    store.getState().editorActions.setEditor(CreateServerEditor('S71', 's7comm'))
    render(<S7CommServerEditor />, { wrapper: createStoreWrapper(store) })
  })

  const serverConfigSection = () => screen.getByRole('button', { name: 'Server Configuration' })
  const fields = () =>
    Array.from(screen.getByLabelText('Server content container').querySelectorAll<HTMLInputElement>('input'))

  it('should leave at least one field editable while no debug session is open', () => {
    expect(fields().length).toBeGreaterThan(0)
    expect(fields().some((field) => !field.matches(':disabled'))).toBe(true)
  })

  it('should lock every field while the debugger is open', () => {
    openDebugSession()

    expect(fields().length).toBeGreaterThan(0)
    expect(fields().every((field) => field.matches(':disabled'))).toBe(true)
  })

  it('should keep the section expander usable while the debugger is open (BR03)', () => {
    openDebugSession()
    fireEvent.click(serverConfigSection())
    fireEvent.click(serverConfigSection())

    expect(fields().length).toBeGreaterThan(0)
  })

  it('should release the fields once the debug session is closed', () => {
    openDebugSession()
    closeDebugSession()

    expect(fields().some((field) => !field.matches(':disabled'))).toBe(true)
  })
})
