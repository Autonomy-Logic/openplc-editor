/**
 * The decoupled bridge between the device screen's "No Firmware Detected" dialog
 * and Build & Upload, which live in different component trees.
 *
 * Worth pinning despite being three lines: the event NAME is the contract between
 * the two sides, and a typo on either would be silent — the dialog's "Build &
 * Upload" button would simply do nothing, with no error to trace. These tests only
 * ever go through the public functions, so they cannot drift from that name.
 */
import { onDeviceFlashRequest, requestDeviceFlash } from '../device-connect-events'

describe('device flash-request bridge', () => {
  it('delivers a request to a subscriber', () => {
    const handler = jest.fn()
    const unsubscribe = onDeviceFlashRequest(handler)

    requestDeviceFlash()

    expect(handler).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('delivers synchronously, so the dialog handler can rely on it having run', () => {
    const order: string[] = []
    const unsubscribe = onDeviceFlashRequest(() => order.push('handler'))

    requestDeviceFlash()
    order.push('after dispatch')

    expect(order).toEqual(['handler', 'after dispatch'])
    unsubscribe()
  })

  it('delivers to every subscriber', () => {
    const first = jest.fn()
    const second = jest.fn()
    const unsubFirst = onDeviceFlashRequest(first)
    const unsubSecond = onDeviceFlashRequest(second)

    requestDeviceFlash()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    unsubFirst()
    unsubSecond()
  })

  it('stops delivering once unsubscribed', () => {
    // The returned function is used as a React effect cleanup, so a listener that
    // survived it would fire once per remount — the user pressing "Build & Upload"
    // once would trigger several builds.
    const handler = jest.fn()
    const unsubscribe = onDeviceFlashRequest(handler)

    unsubscribe()
    requestDeviceFlash()

    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribing one subscriber leaves the others listening', () => {
    const kept = jest.fn()
    const dropped = jest.fn()
    const unsubKept = onDeviceFlashRequest(kept)
    const unsubDropped = onDeviceFlashRequest(dropped)

    unsubDropped()
    requestDeviceFlash()

    expect(kept).toHaveBeenCalledTimes(1)
    expect(dropped).not.toHaveBeenCalled()
    unsubKept()
  })

  it('is safe to call with nobody listening', () => {
    // The device screen can be closed between the dialog opening and the response.
    expect(() => requestDeviceFlash()).not.toThrow()
  })
})
