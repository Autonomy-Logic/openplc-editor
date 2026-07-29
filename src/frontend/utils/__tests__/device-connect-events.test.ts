import { onDeviceFlashRequest, requestDeviceFlash } from '../device-connect-events'

describe('device-connect-events', () => {
  it('delivers a flash request to a subscribed handler', () => {
    const handler = jest.fn()
    const unsubscribe = onDeviceFlashRequest(handler)
    requestDeviceFlash()
    expect(handler).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('stops delivering after unsubscribe', () => {
    const handler = jest.fn()
    const unsubscribe = onDeviceFlashRequest(handler)
    unsubscribe()
    requestDeviceFlash()
    expect(handler).not.toHaveBeenCalled()
  })

  it('fans out to every active subscriber', () => {
    const a = jest.fn()
    const b = jest.fn()
    const unsubA = onDeviceFlashRequest(a)
    const unsubB = onDeviceFlashRequest(b)
    requestDeviceFlash()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    unsubA()
    unsubB()
  })
})
