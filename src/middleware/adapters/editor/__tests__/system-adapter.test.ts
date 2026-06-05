import type { SystemPort } from '../../../shared/ports/system-port'
import { createEditorSystemAdapter } from '../system-adapter'

let adapter: SystemPort

beforeEach(() => {
  window.bridge = {
    getSystemInfo: jest.fn().mockResolvedValue({
      OS: 'darwin',
      architecture: 'x64',
      prefersDarkMode: true,
      isWindowMaximized: false,
    }),
    getStoreValue: jest.fn().mockResolvedValue('stored-value'),
    setStoreValue: jest.fn(),
    openExternalLinkAccelerator: jest.fn().mockResolvedValue({ success: true }),
    log: jest.fn(),
  } as unknown as typeof window.bridge

  adapter = createEditorSystemAdapter()
})

describe('getSystemInfo', () => {
  it('delegates to bridge', async () => {
    const result = await adapter.getSystemInfo()

    expect(window.bridge.getSystemInfo).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      OS: 'darwin',
      architecture: 'x64',
      prefersDarkMode: true,
      isWindowMaximized: false,
    })
  })
})

describe('getStoreValue', () => {
  it('delegates to bridge with key', async () => {
    const result = await adapter.getStoreValue('theme')

    expect(window.bridge.getStoreValue).toHaveBeenCalledWith('theme')
    expect(result).toBe('stored-value')
  })
})

describe('setStoreValue', () => {
  it('delegates to bridge with key and value', () => {
    adapter.setStoreValue('theme', 'dark')

    expect(window.bridge.setStoreValue).toHaveBeenCalledWith('theme', 'dark')
  })
})

describe('openExternalLink', () => {
  it('delegates to bridge with URL', async () => {
    const result = await adapter.openExternalLink('https://example.com')

    expect(window.bridge.openExternalLinkAccelerator).toHaveBeenCalledWith('https://example.com')
    expect(result).toEqual({ success: true })
  })
})

describe('log', () => {
  it('delegates to bridge with level and message', () => {
    adapter.log('info', 'test message')
    expect(window.bridge.log).toHaveBeenCalledWith('info', 'test message')

    adapter.log('error', 'error message')
    expect(window.bridge.log).toHaveBeenCalledWith('error', 'error message')
  })
})
