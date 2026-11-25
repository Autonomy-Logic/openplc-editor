import type { OpenPLCStore } from '@root/frontend/store'
import { createTestStore } from '@root/frontend/store/testing'

const LEGACY_SERIAL = { baud_rate: '115200', enable_rs485_en_pin: true, rs485_en_pin: '17' }

let store: OpenPLCStore

const serialBucket = (): Record<string, unknown> | undefined =>
  store.getState().deviceDefinitions.configuration.vendorScreenData?.['serial'] as Record<string, unknown> | undefined

describe('writing the Serial screen state', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().deviceActions.setVendorScreenData('serial', { ...LEGACY_SERIAL })
  })

  it('removes the legacy pair on the first write of the per-UART pins', () => {
    store.getState().deviceActions.setVendorScreenData('serial', { ...LEGACY_SERIAL, rs485_en_pins: { Serial1: '22' } })

    expect(serialBucket()).toEqual({ baud_rate: '115200', rs485_en_pins: { Serial1: '22' } })
  })

  it('removes the legacy pair when the per-UART pins are written empty', () => {
    store.getState().deviceActions.setVendorScreenData('serial', { ...LEGACY_SERIAL, rs485_en_pins: {} })

    expect(serialBucket()).toEqual({ baud_rate: '115200', rs485_en_pins: {} })
  })

  it('is idempotent', () => {
    const write = { ...LEGACY_SERIAL, rs485_en_pins: { Serial1: '22' } }
    store.getState().deviceActions.setVendorScreenData('serial', write)
    const first = serialBucket()

    store.getState().deviceActions.setVendorScreenData('serial', { ...first })

    expect(serialBucket()).toEqual(first)
    expect(serialBucket()).toEqual({ baud_rate: '115200', rs485_en_pins: { Serial1: '22' } })
  })

  it('keeps the legacy pair while the per-UART pins are never written', () => {
    store.getState().deviceActions.setVendorScreenData('serial', { ...LEGACY_SERIAL, baud_rate: '9600' })

    expect(serialBucket()).toEqual({ baud_rate: '9600', enable_rs485_en_pin: true, rs485_en_pin: '17' })
  })

  it('does not bring the legacy pair back on a later write', () => {
    store.getState().deviceActions.setVendorScreenData('serial', { ...LEGACY_SERIAL, rs485_en_pins: { Serial1: '22' } })
    store.getState().deviceActions.setVendorScreenData('serial', { ...serialBucket(), baud_rate: '9600' })

    expect(serialBucket()).toEqual({ baud_rate: '9600', rs485_en_pins: { Serial1: '22' } })
  })
})
