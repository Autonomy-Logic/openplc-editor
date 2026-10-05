import { createEditorAppUpdateAdapter } from '../app-update-adapter'

let pushStatus: ((status: unknown) => void) | null = null
const unsubscribe = jest.fn()

beforeEach(() => {
  pushStatus = null
  unsubscribe.mockClear()
  window.bridge = {
    appUpdateGetStatus: jest.fn().mockResolvedValue({ state: 'available', version: '4.3.3' }),
    appUpdateDownload: jest.fn(),
    onAppUpdateStatus: jest.fn().mockImplementation((callback: (status: unknown) => void) => {
      pushStatus = callback
      return unsubscribe
    }),
  } as unknown as typeof window.bridge
})

describe('editor app update adapter', () => {
  it('reads the status from main', async () => {
    await expect(createEditorAppUpdateAdapter().getStatus()).resolves.toEqual({ state: 'available', version: '4.3.3' })
  })

  it('shows nothing for a status it cannot read', async () => {
    jest.mocked(window.bridge.appUpdateGetStatus).mockResolvedValue({ state: 'available' })
    await expect(createEditorAppUpdateAdapter().getStatus()).resolves.toEqual({ state: 'none' })
  })

  it('passes each change on, validated, and hands back the bridge unsubscribe', () => {
    const callback = jest.fn()
    const unsub = createEditorAppUpdateAdapter().onStatusChanged(callback)

    pushStatus?.({ state: 'downloading', version: '4.3.3', percent: 10 })
    pushStatus?.('garbage')
    expect(callback.mock.calls).toEqual([
      [{ state: 'downloading', version: '4.3.3', percent: 10 }],
      [{ state: 'none' }],
    ])

    unsub()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('the Update button asks main to download and open the installer', () => {
    createEditorAppUpdateAdapter().downloadAndOpen()
    expect(window.bridge.appUpdateDownload).toHaveBeenCalledTimes(1)
  })
})
