/**
 * Tests for SimulatorServiceFacade.
 *
 * The module exports a singleton `simulatorService`. We re-import it fresh
 * for each test by using jest.isolateModules so state does not leak.
 */

import type { SimulatorPort } from '../../../../middleware/shared/ports/simulator-port'

function makePort(overrides: Partial<SimulatorPort> = {}): SimulatorPort {
  return {
    loadFirmware: jest.fn().mockResolvedValue({ success: true }),
    stop: jest.fn().mockResolvedValue({ success: true }),
    isRunning: jest.fn().mockReturnValue(false),
    onStopped: jest.fn().mockReturnValue(() => {}),
    connectDebugger: jest.fn().mockResolvedValue(undefined),
    disconnectDebugger: jest.fn(),
    getDebugMd5Hash: jest.fn().mockResolvedValue('abc123'),
    getDebugVariablesList: jest.fn().mockResolvedValue({ success: true }),
    setDebugVariable: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  }
}

function loadFreshService() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../simulator-service') as { simulatorService: InstanceType<any> }
  return mod.simulatorService
}

describe('SimulatorServiceFacade', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  // -----------------------------------------------------------------------
  // register
  // -----------------------------------------------------------------------
  describe('register', () => {
    it('subscribes to port onStopped events', () => {
      const service = loadFreshService()
      const port = makePort()
      service.register(port)
      expect(port.onStopped).toHaveBeenCalledTimes(1)
    })

    it('unsubscribes from previous port when re-registering', () => {
      const service = loadFreshService()
      const unsub1 = jest.fn()
      const port1 = makePort({ onStopped: jest.fn().mockReturnValue(unsub1) })
      service.register(port1)

      const port2 = makePort()
      service.register(port2)

      expect(unsub1).toHaveBeenCalledTimes(1)
    })

    it('forwards port stop events to registered callbacks', () => {
      const service = loadFreshService()
      let stopHandler: () => void = () => {}
      const port = makePort({
        onStopped: jest.fn((cb) => {
          stopHandler = cb
          return () => {}
        }),
      })

      const cb = jest.fn()
      service.onStopped(cb)
      service.register(port)

      // Simulate stop event from port
      stopHandler()
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // isRunning
  // -----------------------------------------------------------------------
  describe('isRunning', () => {
    it('returns false when no port registered', () => {
      const service = loadFreshService()
      expect(service.isRunning()).toBe(false)
    })

    it('delegates to port.isRunning', () => {
      const service = loadFreshService()
      const port = makePort({ isRunning: jest.fn().mockReturnValue(true) })
      service.register(port)
      expect(service.isRunning()).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // stop
  // -----------------------------------------------------------------------
  describe('stop', () => {
    it('does nothing when no port registered', () => {
      const service = loadFreshService()
      // Should not throw
      service.stop()
    })

    it('delegates to port.stop', () => {
      const service = loadFreshService()
      const port = makePort()
      service.register(port)
      service.stop()
      expect(port.stop).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // connectDebugger
  // -----------------------------------------------------------------------
  describe('connectDebugger', () => {
    it('throws when no port registered', async () => {
      const service = loadFreshService()
      await expect(service.connectDebugger()).rejects.toThrow('SimulatorPort not registered')
    })

    it('delegates to port.connectDebugger', async () => {
      const service = loadFreshService()
      const port = makePort()
      service.register(port)
      await service.connectDebugger()
      expect(port.connectDebugger).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // disconnectDebugger
  // -----------------------------------------------------------------------
  describe('disconnectDebugger', () => {
    it('does nothing when no port registered', () => {
      const service = loadFreshService()
      // Should not throw
      service.disconnectDebugger()
    })

    it('delegates to port.disconnectDebugger', () => {
      const service = loadFreshService()
      const port = makePort()
      service.register(port)
      service.disconnectDebugger()
      expect(port.disconnectDebugger).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // getMd5Hash
  // -----------------------------------------------------------------------
  describe('getMd5Hash', () => {
    it('throws when no port registered', async () => {
      const service = loadFreshService()
      await expect(service.getMd5Hash()).rejects.toThrow('SimulatorPort not registered')
    })

    it('delegates to port.getDebugMd5Hash', async () => {
      const service = loadFreshService()
      const port = makePort({ getDebugMd5Hash: jest.fn().mockResolvedValue('hash') })
      service.register(port)
      const result = await service.getMd5Hash()
      expect(result).toBe('hash')
    })
  })

  // -----------------------------------------------------------------------
  // getVariablesList
  // -----------------------------------------------------------------------
  describe('getVariablesList', () => {
    it('returns error when no port registered', async () => {
      const service = loadFreshService()
      const result = await service.getVariablesList([0, 1])
      expect(result).toEqual({ success: false, error: 'SimulatorPort not registered' })
    })

    it('delegates to port.getDebugVariablesList', async () => {
      const service = loadFreshService()
      const expected = { success: true, tick: 1, lastIndex: 0, data: 'ff' }
      const port = makePort({ getDebugVariablesList: jest.fn().mockResolvedValue(expected) })
      service.register(port)

      const result = await service.getVariablesList([0])
      expect(result).toEqual(expected)
    })
  })

  // -----------------------------------------------------------------------
  // setVariable
  // -----------------------------------------------------------------------
  describe('setVariable', () => {
    it('returns error when no port registered', async () => {
      const service = loadFreshService()
      const result = await service.setVariable(0, true, 'ff')
      expect(result).toEqual({ success: false, error: 'SimulatorPort not registered' })
    })

    it('delegates to port.setDebugVariable', async () => {
      const service = loadFreshService()
      const port = makePort({ setDebugVariable: jest.fn().mockResolvedValue({ success: true }) })
      service.register(port)

      const result = await service.setVariable(3, true, 'aa')
      expect(result).toEqual({ success: true })
      expect(port.setDebugVariable).toHaveBeenCalledWith(3, true, 'aa')
    })
  })

  // -----------------------------------------------------------------------
  // onStopped
  // -----------------------------------------------------------------------
  describe('onStopped', () => {
    it('returns an unsubscribe function that removes the callback', () => {
      const service = loadFreshService()
      let stopHandler: () => void = () => {}
      const port = makePort({
        onStopped: jest.fn((cb) => {
          stopHandler = cb
          return () => {}
        }),
      })

      const cb = jest.fn()
      const unsub = service.onStopped(cb)
      service.register(port)

      // Fire stop -- callback should be called
      stopHandler()
      expect(cb).toHaveBeenCalledTimes(1)

      // Unsubscribe then fire again
      unsub()
      stopHandler()
      expect(cb).toHaveBeenCalledTimes(1) // Not called again
    })
  })
})
