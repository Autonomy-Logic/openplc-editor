// Byte-identical with openplc-web; runs under Jest and Vitest.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createDefaultMqttIntegration } from '@root/frontend/utils/mqtt/project/model'
import type { RuntimeIdentityPin, RuntimeIdentityPort } from '@root/middleware/shared/ports/runtime-identity-port'

import { RuntimeIdentityPanel } from '../runtime-identity-panel'
import { SecuritySection } from '../security-section'

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const COLONS = (HEX.toUpperCase().match(/.{2}/g) ?? []).join(':')

const memoryPort = () => {
  const pins = new Map<string, RuntimeIdentityPin>()
  const calls: string[] = []
  const port: RuntimeIdentityPort = {
    getPin: (targetKey) => {
      calls.push(`get ${targetKey}`)
      return Promise.resolve(pins.get(targetKey) ?? null)
    },
    setPin: (targetKey, fingerprint) => {
      calls.push(`set ${targetKey}`)
      const sha256 = fingerprint.replace(/:/g, '').toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        return Promise.resolve({ ok: false, code: 'runtime_identity_invalid', message: 'refused by the store' })
      }
      const pin = { sha256, updatedAt: '2026-10-12T10:00:00.000Z' }
      pins.set(targetKey, pin)
      return Promise.resolve({ ok: true, pin })
    },
    removePin: (targetKey) => {
      calls.push(`remove ${targetKey}`)
      pins.delete(targetKey)
      return Promise.resolve()
    },
  }
  return { port, pins, calls }
}

const state = () => screen.getByTestId('runtime-identity-state')

describe('RuntimeIdentityPanel', () => {
  it('pins a typed fingerprint for the target and forgets it', async () => {
    const { port, pins } = memoryPort()
    render(<RuntimeIdentityPanel port={port} targetKey='address:10.1.2.3' />)
    await waitFor(() => expect(state().dataset.state).toBe('untrusted'))
    expect(state().textContent).toContain('openssl x509')

    fireEvent.change(screen.getByLabelText('Runtime certificate SHA-256 fingerprint'), { target: { value: COLONS } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Trust this runtime' })))
    await waitFor(() => expect(state().dataset.state).toBe('trusted'))
    expect(state().textContent).toContain(COLONS)
    expect(pins.get('address:10.1.2.3')?.sha256).toBe(HEX)
    expect(screen.getByLabelText<HTMLInputElement>('Runtime certificate SHA-256 fingerprint').value).toBe('')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forget trusted runtime' })))
    await waitFor(() => expect(state().dataset.state).toBe('untrusted'))
    expect(pins.size).toBe(0)
  })

  it('refuses a malformed fingerprint before asking the store', async () => {
    const { port, calls } = memoryPort()
    render(<RuntimeIdentityPanel port={port} targetKey='address:10.1.2.3' />)
    await waitFor(() => expect(state().dataset.state).toBe('untrusted'))
    fireEvent.change(screen.getByLabelText('Runtime certificate SHA-256 fingerprint'), { target: { value: 'AB:CD' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Trust this runtime' })))
    expect(screen.getByRole('alert').textContent).toContain('64 hexadecimal digits')
    expect(calls.filter((call) => call.startsWith('set'))).toEqual([])
  })

  it('shows the store refusal as text', async () => {
    const { port } = memoryPort()
    const refusing: RuntimeIdentityPort = {
      ...port,
      setPin: () => Promise.resolve({ ok: false, code: 'runtime_identity_unavailable', message: '<b>store full</b>' }),
    }
    render(<RuntimeIdentityPanel port={refusing} targetKey='address:10.1.2.3' />)
    await waitFor(() => expect(state().dataset.state).toBe('untrusted'))
    fireEvent.change(screen.getByLabelText('Runtime certificate SHA-256 fingerprint'), { target: { value: HEX } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Trust this runtime' })))
    expect(screen.getByRole('alert').textContent).toBe('<b>store full</b>')
    expect(screen.getByRole('alert').querySelector('b')).toBeNull()
  })

  it('reloads for a new target and ignores the answer for the previous one', async () => {
    const { port, pins } = memoryPort()
    pins.set('address:10.1.2.3', { sha256: HEX, updatedAt: 'then' })
    let releaseSlow: (pin: RuntimeIdentityPin | null) => void = () => undefined
    const slow: RuntimeIdentityPort = {
      ...port,
      getPin: (targetKey) =>
        targetKey === 'address:10.1.2.3' ? new Promise((resolve) => (releaseSlow = resolve)) : port.getPin(targetKey),
    }
    const { rerender } = render(<RuntimeIdentityPanel port={slow} targetKey='address:10.1.2.3' />)
    rerender(<RuntimeIdentityPanel port={slow} targetKey='address:10.9.9.9' />)
    await waitFor(() => expect(state().dataset.state).toBe('untrusted'))
    await act(async () => releaseSlow({ sha256: HEX, updatedAt: 'then' }))
    expect(state().dataset.state).toBe('untrusted')
  })
})

describe('SecuritySection runtime identity', () => {
  const props = (authMethod: 'anonymous' | 'username_password') => {
    const integration = { ...createDefaultMqttIntegration('plc-1'), authMethod }
    return {
      integration,
      issues: [],
      commit: () => undefined,
      credentialBinding:
        authMethod === 'anonymous'
          ? null
          : { host: '', port: 8883, tlsEnabled: true, clientId: 'plc-1', method: 'username_password' as const },
      credentialState: { kind: 'missing' as const },
      persistence: 'protected' as const,
      onSaveCredential: () => Promise.resolve({ ok: true as const, presence: { present: true } }),
      onRemoveCredential: () => Promise.resolve(),
    }
  }

  it('appears for a credential method when the platform pins runtimes and a target is set', async () => {
    const { port } = memoryPort()
    render(<SecuritySection {...props('username_password')} runtimeIdentity={port} targetKey='address:10.1.2.3' />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Runtime identity' })).toBeTruthy())
  })

  it('is absent for anonymous access, without a target, or on a platform without the port', () => {
    const { port } = memoryPort()
    const { rerender } = render(
      <SecuritySection {...props('anonymous')} runtimeIdentity={port} targetKey='address:x' />,
    )
    expect(screen.queryByRole('region', { name: 'Runtime identity' })).toBeNull()
    rerender(<SecuritySection {...props('username_password')} runtimeIdentity={port} targetKey={null} />)
    expect(screen.queryByRole('region', { name: 'Runtime identity' })).toBeNull()
    rerender(<SecuritySection {...props('username_password')} targetKey='address:x' />)
    expect(screen.queryByRole('region', { name: 'Runtime identity' })).toBeNull()
  })
})
