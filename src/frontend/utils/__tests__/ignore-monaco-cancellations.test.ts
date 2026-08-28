import { installMonacoCancellationGuard } from '@root/frontend/utils/ignore-monaco-cancellations'

/**
 * `PromiseRejectionEvent` is not implemented in jsdom, and the guard reads only
 * `reason` and calls `preventDefault`. A plain `Event` carrying those two is
 * enough to exercise it, and keeps the test off a DOM API the runner lacks.
 */
const rejectionEvent = (reason: unknown) => {
  const event = new Event('unhandledrejection', { cancelable: true })
  Object.defineProperty(event, 'reason', { value: reason })
  return event
}

const cancellation = () => {
  const error = new Error('Canceled')
  error.name = 'Canceled'
  return error
}

describe('installMonacoCancellationGuard', () => {
  beforeAll(() => {
    installMonacoCancellationGuard()
  })

  it("swallows Monaco's cancellation rejections", () => {
    const event = rejectionEvent(cancellation())
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('lets every other rejection through', () => {
    const event = rejectionEvent(new Error('Request failed with status code 500'))
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('lets through an error that only reads like a cancellation', () => {
    // The message alone is not the signal: a backend that answers "Canceled"
    // must still reach whatever reports errors to the user.
    const event = rejectionEvent(new Error('Canceled'))
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('lets through a non-Error rejection', () => {
    const event = rejectionEvent({ name: 'Canceled' })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('registers one listener however many times it is installed', () => {
    installMonacoCancellationGuard()
    installMonacoCancellationGuard()
    // The same function reference goes in every time, so the browser
    // de-duplicates: repeat installs never double-handle a rejection.
    let seen = 0
    const count = () => {
      seen += 1
    }
    window.addEventListener('unhandledrejection', count)
    window.dispatchEvent(rejectionEvent(cancellation()))
    window.removeEventListener('unhandledrejection', count)
    expect(seen).toBe(1)
  })
})
