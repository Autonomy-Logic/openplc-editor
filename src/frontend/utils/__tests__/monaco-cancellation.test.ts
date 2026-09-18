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
})
