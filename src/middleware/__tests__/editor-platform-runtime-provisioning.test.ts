import { createTestStore } from '../../frontend/store/testing'
import { createEditorPorts } from '../editor-platform'

const probeRequests: unknown[] = []

function idle(): Promise<undefined> {
  return Promise.resolve(undefined)
}

const bridge = new Proxy<Record<string, unknown>>(
  {},
  {
    get: (_target, member) => {
      if (member === 'runtimeProvisioningProbeSsh') {
        return (request: unknown) => {
          probeRequests.push(request)
          return Promise.resolve({ answered: true })
        }
      }
      return idle
    },
  },
)

beforeEach(() => {
  probeRequests.splice(0)
  Object.defineProperty(window, 'bridge', { value: bridge, writable: true, configurable: true })
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches: false, media: query }),
    writable: true,
    configurable: true,
  })
})

describe('the editor platform', () => {
  it('wires the runtime provisioning port to the desktop bridge', async () => {
    const ports = createEditorPorts(createTestStore())
    const request = { host: '192.168.1.50', port: 22 }

    expect(ports.runtimeProvisioning).toBeDefined()
    await expect(ports.runtimeProvisioning?.probeSsh(request)).resolves.toEqual({ answered: true })
    expect(probeRequests).toEqual([request])
  })
})
