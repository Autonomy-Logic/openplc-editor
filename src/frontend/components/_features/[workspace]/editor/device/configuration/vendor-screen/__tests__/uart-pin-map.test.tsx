import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { BoardInfo, PLCServer } from '@root/middleware/shared/ports/types'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import type { ScreenSection } from '../index'
import { SectionRenderer } from '../section-renderer'

const BAUD_FIELD = {
  id: 'baud_rate',
  label: 'Baud Rate',
  type: 'select',
  options: ['9600', '115200'],
  default: '115200',
}

/** The Serial screen the packages ship once they declare per-UART pins. */
const PER_UART_SECTION = {
  id: 'serial',
  title: 'Serial Port',
  layout: 'form',
  fields: [
    BAUD_FIELD,
    {
      id: 'rs485_en_pins',
      label: 'RS-485 EN Pin',
      type: 'uart-pin-map',
      optionsRef: 'board.serialPorts',
      validation: '^[A-Z]{0,2}\\d{1,3}$',
    },
  ],
} as ScreenSection

/** Today's Serial screen: one pin behind a switch. */
const LEGACY_SECTION = {
  id: 'serial',
  title: 'Serial Port',
  layout: 'form',
  fields: [
    BAUD_FIELD,
    { id: 'enable_rs485_en_pin', label: 'Use RS485 EN Pin', type: 'boolean', default: false },
    {
      id: 'rs485_en_pin',
      label: 'RS485 EN Pin',
      type: 'text',
      default: '',
      validation: '^[A-Z]{0,2}\\d{1,3}$',
      visible: { condition: 'fields.enable_rs485_en_pin', operator: 'equals', value: true },
    },
  ],
} as ScreenSection

const board = (section: ScreenSection, over: Partial<BoardInfo>): BoardInfo => ({
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  preview: '',
  specs: {},
  defaultSerial: 'Serial',
  vpp: {
    packageId: 'com.openplc.arduino',
    vendor: 'OpenPLC',
    deviceId: 'board',
    packagePath: '/packages/com.openplc.arduino',
    screens: { Serial: { sections: [section] } },
    moduleSystem: null,
  },
  ...over,
})

const MEGA = board(PER_UART_SECTION, { serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'] })
const FX3U = board(PER_UART_SECTION, { serialPorts: ['Serial', 'Serial3'], rs485FixedPins: { Serial3: 'PA14' } })
const LEGACY_MEGA = board(LEGACY_SECTION, { serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'] })

const LEGACY_STATE = { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: '17' }

const modbusServer = (config: Partial<NonNullable<PLCServer['modbusSlaveConfig']>>): PLCServer => ({
  name: 'Modbus',
  protocol: 'modbus-tcp',
  modbusSlaveConfig: { enabled: true, transports: ['rtu'], networkInterface: '0.0.0.0', port: 502, ...config },
})

let store: OpenPLCStore

/** Opens a project on `info` with the given Serial state and servers, and renders its Serial section. */
function openSerialScreen(
  info: BoardInfo,
  section: ScreenSection,
  serial: Record<string, unknown> = { baud_rate: '115200' },
  servers: PLCServer[] = [],
) {
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([['Board', info]]) })
  store.getState().deviceActions.setDeviceBoard('Board')
  store.getState().deviceActions.setVendorScreenData('serial', serial)
  const { project } = store.getState()
  store.getState().projectActions.setProject({ ...project, data: { ...project.data, servers } })
  render(<SectionRenderer section={section} moduleSystem={null} />, { wrapper: createStoreWrapper(store) })
}

const serialBucket = (): Record<string, unknown> =>
  (store.getState().deviceDefinitions.configuration.vendorScreenData?.['serial'] as Record<string, unknown>) ?? {}

const pinInput = (uart: string): HTMLInputElement => screen.getByTestId(`serial-rs485-pin-${uart}`) as HTMLInputElement

const pinInputIds = (): string[] =>
  within(screen.getByTestId('serial-rs485-pins'))
    .queryAllByTestId(/^serial-rs485-pin-/)
    .map((input) => input.getAttribute('data-testid') ?? '')

/** Matches an accessible name that holds `uart` as a whole word. */
const namesUart = (uart: string) => (name: string) => name.split(/\s+/).includes(uart)

const enterPin = (uart: string, value: string) => {
  fireEvent.change(pinInput(uart), { target: { value } })
  fireEvent.blur(pinInput(uart))
}

describe('Serial screen uart-pin-map field', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  afterEach(cleanup)

  describe('TC20: which UARTs offer a pin', () => {
    it('offers one RS-485 pin input per UART of the Mega, in manifest order', () => {
      openSerialScreen(MEGA, PER_UART_SECTION)

      expect(pinInputIds()).toEqual([
        'serial-rs485-pin-Serial',
        'serial-rs485-pin-Serial1',
        'serial-rs485-pin-Serial2',
        'serial-rs485-pin-Serial3',
      ])
    })

    it.each(['Serial', 'Serial1', 'Serial2', 'Serial3'])('labels the %s input with the UART name', (uart) => {
      openSerialScreen(MEGA, PER_UART_SECTION)

      expect(screen.getByRole('textbox', { name: namesUart(uart) })).toBe(pinInput(uart))
    })

    it('offers no input for the UART whose pin the FX3U package fixes', () => {
      openSerialScreen(FX3U, PER_UART_SECTION)

      expect(pinInputIds()).toEqual(['serial-rs485-pin-Serial'])
      expect(screen.queryByTestId('serial-rs485-pin-Serial3')).toBeNull()
      expect(screen.queryByDisplayValue('PA14')).toBeNull()
    })

    it("keeps today's single pin on a legacy Serial screen", () => {
      openSerialScreen(LEGACY_MEGA, LEGACY_SECTION, LEGACY_STATE)

      expect(screen.getAllByLabelText('Use RS485 EN Pin').length).toBeGreaterThan(0)
      expect((screen.getByLabelText('RS485 EN Pin') as HTMLInputElement).value).toBe('17')
      expect(screen.queryByTestId('serial-rs485-pins')).toBeNull()
    })
  })

  describe('persisted value', () => {
    it('saves a valid pin under its UART, with keys only for non-empty pins', () => {
      openSerialScreen(MEGA, PER_UART_SECTION)

      enterPin('Serial1', '22')

      expect(serialBucket().rs485_en_pins).toEqual({ Serial1: '22' })
    })

    it.each(['PA14', '7', 'A0'])('saves the pin %j as entered', (pin) => {
      openSerialScreen(MEGA, PER_UART_SECTION)

      enterPin('Serial2', pin)

      expect(serialBucket().rs485_en_pins).toEqual({ Serial2: pin })
    })

    it('drops the UART key when its pin is cleared', () => {
      openSerialScreen(MEGA, PER_UART_SECTION)
      enterPin('Serial1', '22')

      enterPin('Serial1', '')

      expect(Object.keys((serialBucket().rs485_en_pins as Record<string, string> | undefined) ?? {})).toEqual([])
    })

    it.each(['-1', 'pa14', 'ABC1', '1234', ' 22'])(
      'shows the validation error naming the UART and saves nothing for %j',
      (pin) => {
        openSerialScreen(MEGA, PER_UART_SECTION)
        const container = screen.getByTestId('serial-rs485-pins')
        expect(within(container).queryByRole('alert')).toBeNull()
        const before = JSON.stringify(serialBucket())

        enterPin('Serial1', pin)

        expect(within(container).getByRole('alert').textContent).toContain('Serial1')
        expect(JSON.stringify(serialBucket())).toBe(before)
      },
    )

    it('saves the migrated pin it showed and removes the legacy pair on the first per-UART write', () => {
      openSerialScreen(MEGA, PER_UART_SECTION, LEGACY_STATE, [modbusServer({ serialPort: 'Serial2' })])

      enterPin('Serial1', '22')

      expect(serialBucket()).toEqual({ baud_rate: '115200', rs485_en_pins: { Serial1: '22', Serial2: '17' } })
    })

    it('removes the legacy pair it showed on no UART on the first per-UART write without an RTU server', () => {
      openSerialScreen(MEGA, PER_UART_SECTION, LEGACY_STATE)

      enterPin('Serial1', '22')

      expect(serialBucket()).toEqual({ baud_rate: '115200', rs485_en_pins: { Serial1: '22' } })
    })
  })

  describe("a 4.3.x project's pin on a per-UART package", () => {
    it('shows the pin on the secondary UART the Modbus RTU server uses', () => {
      openSerialScreen(MEGA, PER_UART_SECTION, LEGACY_STATE, [modbusServer({ serialPort: 'Serial2' })])

      expect(pinInput('Serial2').value).toBe('17')
      expect(pinInput('Serial').value).toBe('')
      expect(pinInput('Serial1').value).toBe('')
      expect(pinInput('Serial3').value).toBe('')
    })

    it('shows the pin on the default UART when the Modbus RTU server uses it', () => {
      openSerialScreen(MEGA, PER_UART_SECTION, LEGACY_STATE, [modbusServer({})])

      expect(pinInput('Serial').value).toBe('17')
      expect(pinInput('Serial2').value).toBe('')
    })

    it.each([
      ['no server', []],
      ['a TCP-only server', [modbusServer({ transports: ['tcp'] })]],
      ['a disabled RTU server', [modbusServer({ enabled: false, serialPort: 'Serial2' })]],
    ])('shows the pin on no UART with %s', (_label, servers) => {
      openSerialScreen(MEGA, PER_UART_SECTION, LEGACY_STATE, servers as PLCServer[])

      for (const uart of ['Serial', 'Serial1', 'Serial2', 'Serial3']) expect(pinInput(uart).value).toBe('')
    })

    it('does not rewrite the Serial state on opening', () => {
      openSerialScreen(MEGA, PER_UART_SECTION, LEGACY_STATE, [modbusServer({ serialPort: 'Serial2' })])

      expect(serialBucket()).toEqual(LEGACY_STATE)
    })

    it('does not rewrite the Serial state on opening without an RTU server', () => {
      openSerialScreen(MEGA, PER_UART_SECTION, LEGACY_STATE)

      expect(serialBucket()).toEqual(LEGACY_STATE)
    })

    it('shows the legacy pin nowhere when the RTU server sits on a UART with a fixed pin', () => {
      openSerialScreen(FX3U, PER_UART_SECTION, LEGACY_STATE, [modbusServer({ serialPort: 'Serial3' })])

      expect(screen.queryByTestId('serial-rs485-pin-Serial3')).toBeNull()
      expect(pinInput('Serial').value).toBe('')
    })
  })
})
