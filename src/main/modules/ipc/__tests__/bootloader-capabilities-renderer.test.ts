import rendererProcessBridge from '../renderer'

const mockInvoke = jest.fn()

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: (...args: unknown[]) => mockInvoke(...args),
    on: jest.fn(),
    removeListener: jest.fn(),
  },
  contextBridge: { exposeInMainWorld: jest.fn() },
}))

type CapabilitiesSender = (ipAddress: string, options?: { timeoutMs?: number }) => Promise<unknown>

const CHANNEL = 'bootloader:get-capabilities'
const IP = '192.168.1.50'
const send: CapabilitiesSender = rendererProcessBridge.bootloaderGetCapabilities

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ success: false, error: 'No response from the bootloader' })
})

describe('the bootloaderGetCapabilities renderer bridge', () => {
  it('sends the options with the address over bootloader:get-capabilities', async () => {
    const options = { timeoutMs: 2500 }

    await send(IP, options)

    expect(mockInvoke).toHaveBeenCalledWith(CHANNEL, IP, options)
  })

  it('sends only the address when no options are given', async () => {
    await send(IP)

    expect(mockInvoke.mock.calls).toEqual([[CHANNEL, IP]])
  })
})
