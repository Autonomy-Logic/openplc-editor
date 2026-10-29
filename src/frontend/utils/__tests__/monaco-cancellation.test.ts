/**
 * @jest-environment jsdom
 */
import { installMonacoCancellationGuard, isMonacoCancellation } from '../monaco-cancellation'

const canceled = () => {
  const error = new Error('Canceled')
  error.name = 'Canceled'
  return error
}

const rejectionEvent = (reason: unknown) => {
  const event = new Event('unhandledrejection', { cancelable: true })
  Object.defineProperty(event, 'reason', { value: reason })
  return event
}

describe('isMonacoCancellation', () => {
  it('accepts the error Monaco rejects cancelled work with', () => {
    expect(isMonacoCancellation(canceled())).toBe(true)
  })

  it('rejects an error that only borrows the name', () => {
    const error = new Error('Request cancelled by the user')
    error.name = 'Canceled'
    expect(isMonacoCancellation(error)).toBe(false)
  })

  it('rejects a real failure', () => {
    expect(isMonacoCancellation(new Error('Canceled the wrong way'))).toBe(false)
    expect(isMonacoCancellation(new TypeError('Canceled'))).toBe(false)
  })

  it('rejects a non-error reason', () => {
    expect(isMonacoCancellation('Canceled')).toBe(false)
    expect(isMonacoCancellation(undefined)).toBe(false)
  })
})

describe('installMonacoCancellationGuard', () => {
  it('swallows a cancellation rejection', () => {
    const uninstall = installMonacoCancellationGuard()
    const event = rejectionEvent(canceled())
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    uninstall()
  })

  it('leaves a real rejection to be reported', () => {
    const uninstall = installMonacoCancellationGuard()
    const event = rejectionEvent(new Error('worker died'))
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    uninstall()
  })

  it('stops swallowing once uninstalled', () => {
    installMonacoCancellationGuard()()
    const event = rejectionEvent(canceled())
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  // Disposal cancels a token inside an emitter, which rethrows synchronously.
  it('swallows a cancellation that arrives as an uncaught error', () => {
    const uninstall = installMonacoCancellationGuard()
    const event = new ErrorEvent('error', { error: canceled(), cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    uninstall()
  })

  it('leaves a real uncaught error to be reported', () => {
    const uninstall = installMonacoCancellationGuard()
    const event = new ErrorEvent('error', { error: new Error('worker died'), cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    uninstall()
  })

  // The dev overlay listens on `window` too and never reads `defaultPrevented`,
  // so preventing the default is not enough to keep its crash screen shut.
  describe('a listener registered after the guard', () => {
    it('never sees a cancellation rejection', () => {
      const uninstall = installMonacoCancellationGuard()
      const overlay = jest.fn()
      window.addEventListener('unhandledrejection', overlay)

      window.dispatchEvent(rejectionEvent(canceled()))

      expect(overlay).not.toHaveBeenCalled()
      window.removeEventListener('unhandledrejection', overlay)
      uninstall()
    })

    it('never sees a cancellation error', () => {
      const uninstall = installMonacoCancellationGuard()
      const overlay = jest.fn()
      window.addEventListener('error', overlay)

      window.dispatchEvent(new ErrorEvent('error', { error: canceled(), cancelable: true }))

      expect(overlay).not.toHaveBeenCalled()
      window.removeEventListener('error', overlay)
      uninstall()
    })

    it('still sees a real failure', () => {
      const uninstall = installMonacoCancellationGuard()
      const overlay = jest.fn()
      window.addEventListener('error', overlay)

      window.dispatchEvent(new ErrorEvent('error', { error: new Error('worker died'), cancelable: true }))

      expect(overlay).toHaveBeenCalledTimes(1)
      window.removeEventListener('error', overlay)
      uninstall()
    })
  })
})
