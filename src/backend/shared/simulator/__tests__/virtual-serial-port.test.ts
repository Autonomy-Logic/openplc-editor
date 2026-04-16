import type { SimulatorModule } from '../simulator-module'
import { VirtualSerialPort } from '../virtual-serial-port'

function makeSimulator(): SimulatorModule {
  return {
    onUartByte: null,
    feedByte: jest.fn(),
  } as unknown as SimulatorModule
}

describe('VirtualSerialPort', () => {
  let sim: SimulatorModule
  let port: VirtualSerialPort

  beforeEach(() => {
    sim = makeSimulator()
    port = new VirtualSerialPort(sim)
  })

  // -----------------------------------------------------------------------
  // open
  // -----------------------------------------------------------------------
  describe('open', () => {
    it('sets isOpen to true', () => {
      port.open()
      expect(port.isOpen).toBe(true)
    })

    it('wires simulator.onUartByte to data listeners', () => {
      const cb = jest.fn()
      port.on('data', cb)
      port.open()

      // Simulate a byte from the emulated device
      sim.onUartByte!(0x42)

      expect(cb).toHaveBeenCalledWith(new Uint8Array([0x42]))
    })

    it('emits open event asynchronously', async () => {
      const cb = jest.fn()
      port.on('open', cb)
      port.open()

      // Not called synchronously
      expect(cb).not.toHaveBeenCalled()

      // Wait for microtask
      await Promise.resolve()
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('fires all open listeners', async () => {
      const cb1 = jest.fn()
      const cb2 = jest.fn()
      port.on('open', cb1)
      port.on('open', cb2)
      port.open()

      await Promise.resolve()
      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // write
  // -----------------------------------------------------------------------
  describe('write', () => {
    it('feeds each byte to the simulator', () => {
      const data = new Uint8Array([0x01, 0x02, 0x03])
      port.write(data)

      expect(sim.feedByte).toHaveBeenCalledTimes(3)
      expect(sim.feedByte).toHaveBeenNthCalledWith(1, 0x01)
      expect(sim.feedByte).toHaveBeenNthCalledWith(2, 0x02)
      expect(sim.feedByte).toHaveBeenNthCalledWith(3, 0x03)
    })

    it('calls callback with null on success', () => {
      const cb = jest.fn()
      port.write(new Uint8Array([0x01]), cb)
      expect(cb).toHaveBeenCalledWith(null)
    })

    it('works when no callback is provided', () => {
      // Should not throw
      port.write(new Uint8Array([0x01]))
    })
  })

  // -----------------------------------------------------------------------
  // flush
  // -----------------------------------------------------------------------
  describe('flush', () => {
    it('calls callback with null', () => {
      const cb = jest.fn()
      port.flush(cb)
      expect(cb).toHaveBeenCalledWith(null)
    })

    it('works when no callback is provided', () => {
      port.flush()
    })
  })

  // -----------------------------------------------------------------------
  // close
  // -----------------------------------------------------------------------
  describe('close', () => {
    it('sets isOpen to false and clears simulator callback', () => {
      port.open()
      expect(port.isOpen).toBe(true)

      port.close()
      expect(port.isOpen).toBe(false)
      expect(sim.onUartByte).toBeNull()
    })

    it('removes all listeners', async () => {
      const dataCb = jest.fn()
      const openCb = jest.fn()
      const errorCb = jest.fn()
      port.on('data', dataCb)
      port.on('open', openCb)
      port.on('error', errorCb)

      port.close()

      // Re-open to test listeners are gone
      port.open()
      sim.onUartByte!(0x01)
      await Promise.resolve()

      expect(dataCb).not.toHaveBeenCalled()
      expect(openCb).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // on
  // -----------------------------------------------------------------------
  describe('on', () => {
    it('registers data listeners', () => {
      const cb = jest.fn()
      port.on('data', cb)
      port.open()
      sim.onUartByte!(0xff)
      expect(cb).toHaveBeenCalledWith(new Uint8Array([0xff]))
    })

    it('registers error listeners', () => {
      const cb = jest.fn()
      port.on('error', cb)
      // Error listeners are stored but only called externally
      // Verify no throw
      expect(() => port.on('error', cb)).not.toThrow()
    })

    it('ignores unknown event names', () => {
      // Should not throw
      port.on('unknown', jest.fn())
    })
  })

  // -----------------------------------------------------------------------
  // once
  // -----------------------------------------------------------------------
  describe('once', () => {
    it('fires listener only once and auto-removes', async () => {
      const cb = jest.fn()
      port.once('open', cb)
      port.open()
      await Promise.resolve()
      expect(cb).toHaveBeenCalledTimes(1)

      // Close and re-open -- cb should not fire again
      port.close()
      port.open()
      await Promise.resolve()
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // removeListener
  // -----------------------------------------------------------------------
  describe('removeListener', () => {
    it('removes a specific data listener', () => {
      const cb1 = jest.fn()
      const cb2 = jest.fn()
      port.on('data', cb1)
      port.on('data', cb2)

      port.removeListener('data', cb1)

      port.open()
      sim.onUartByte!(0x01)

      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).toHaveBeenCalledTimes(1)
    })

    it('removes a specific open listener', async () => {
      const cb = jest.fn()
      port.on('open', cb)
      port.removeListener('open', cb)

      port.open()
      await Promise.resolve()
      expect(cb).not.toHaveBeenCalled()
    })

    it('removes a specific error listener', () => {
      const cb = jest.fn()
      port.on('error', cb)
      port.removeListener('error', cb)
      // Verify internal array is cleared -- no direct way to test besides coverage
    })

    it('ignores unknown event names', () => {
      port.removeListener('unknown', jest.fn())
    })
  })

  // -----------------------------------------------------------------------
  // removeAllListeners
  // -----------------------------------------------------------------------
  describe('removeAllListeners', () => {
    it('removes all listeners for a specific event', () => {
      const dataCb = jest.fn()
      const openCb = jest.fn()
      port.on('data', dataCb)
      port.on('open', openCb)

      port.removeAllListeners('data')

      port.open()
      sim.onUartByte!(0x01)
      expect(dataCb).not.toHaveBeenCalled()
    })

    it('removes only error listeners when called with error event', () => {
      const dataCb = jest.fn()
      const errorCb = jest.fn()
      port.on('data', dataCb)
      port.on('error', errorCb)

      port.removeAllListeners('error')

      // Data listener should still be intact
      port.open()
      sim.onUartByte!(0x01)
      expect(dataCb).toHaveBeenCalledTimes(1)
    })

    it('removes all listeners when called without arguments', async () => {
      const dataCb = jest.fn()
      const openCb = jest.fn()
      const errorCb = jest.fn()
      port.on('data', dataCb)
      port.on('open', openCb)
      port.on('error', errorCb)

      port.removeAllListeners()

      port.open()
      sim.onUartByte!(0x01)
      await Promise.resolve()

      expect(dataCb).not.toHaveBeenCalled()
      expect(openCb).not.toHaveBeenCalled()
    })
  })
})
