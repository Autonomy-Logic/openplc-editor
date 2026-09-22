import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { PlatformProvider } from '@root/middleware/shared/providers'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from '@jest/globals'

import type { PluginCommandOutcome } from '@root/backend/shared/utils/vpp/screen-actions'

import { VppScreenActions } from '../screen-actions'

const stubPort = <T,>(overrides: Partial<T> = {}): T => overrides as T

/**
 * A recording stub, written by hand rather than with `vi.fn` / `jest.fn`:
 * this file is on the byte-identical shared surface, and the two repos run it
 * under different runners. The helper is what keeps one file valid for both.
 */
function recorder(impl: () => Promise<PluginCommandOutcome>) {
  const calls: unknown[][] = []
  const fn = (...args: unknown[]): Promise<PluginCommandOutcome> => {
    calls.push(args)
    return impl()
  }
  fn.calls = calls
  return fn as ((...args: unknown[]) => Promise<PluginCommandOutcome>) & { calls: unknown[][] }
}

function renderActions(
  sendPluginCommand: PlatformPorts['runtime']['sendPluginCommand'] | undefined,
  props: Partial<React.ComponentProps<typeof VppScreenActions>> = {},
) {
  const ports = {
    compiler: stubPort(),
    runtime: stubPort({ sendPluginCommand }),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    stlibSource: stubPort(),
    esi: stubPort(),
    versionControl: stubPort(),
    capabilities: stubPort(),
  } as unknown as PlatformPorts

  return render(
    <PlatformProvider ports={ports}>
      <VppScreenActions
        actions={[
          { id: 'discover', label: 'Discover modules', type: 'plugin-command', command: 'discover' },
          { id: 'status', label: 'Status', type: 'plugin-command', command: 'status' },
        ]}
        defaultPlugin='synergy'
        {...props}
      />
    </PlatformProvider>,
  )
}

describe('VppScreenActions', () => {
  afterEach(cleanup)

  it('sends the declared plugin command and renders the result', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: { modules: ['AI8', 'DO16'] } }))
    renderActions(send)

    fireEvent.click(screen.getByRole('button', { name: 'Discover modules' }))

    await waitFor(() => expect(screen.getByTestId('vpp-action-result-discover')).toBeTruthy())
    expect(send.calls).toEqual([[{ plugin: 'synergy', command: 'discover', params: {} }]])
    expect(screen.getByTestId('vpp-action-result-discover').textContent).toContain('AI8')
  })

  it('renders a plugin failure as an error, not as a result', async () => {
    renderActions(recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: false, error: 'no backplane detected' })))

    fireEvent.click(screen.getByRole('button', { name: 'Discover modules' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-discover').textContent).toContain('no backplane detected'),
    )
  })

  it('does not hang when the device never answers', async () => {
    // The adapter bounds the call; the panel's job is to reflect the rejection
    // it gets back rather than stay in "running" for ever.
    renderActions(recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: false, error: 'The device did not answer in time.' })))

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-status').textContent).toContain('did not answer in time'),
    )
    expect(screen.getByRole('button', { name: 'Status' }).hasAttribute('disabled')).toBe(false)
  })

  it('refuses to start a second run while one is in flight', async () => {
    let release: (value: unknown) => void = () => undefined
    const pending = new Promise<PluginCommandOutcome>((resolve) => (release = resolve as (value: unknown) => void))
    const send = recorder(() => pending)
    renderActions(send)

    fireEvent.click(screen.getByRole('button', { name: 'Discover modules' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Discover modules…/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Discover modules…/ }))

    expect(send.calls).toHaveLength(1)
    release({ ok: true, data: {} })
  })

  it('drops a late answer that belongs to a superseded run', async () => {
    const answers: Array<(value: unknown) => void> = []
    const send = recorder(
      () => new Promise<PluginCommandOutcome>((resolve) => answers.push(resolve as (value: unknown) => void)),
    )
    const ports = {
      runtime: stubPort({ sendPluginCommand: send }),
      capabilities: stubPort(),
    } as unknown as PlatformPorts
    const tree = (deviceKey: string) => (
      <PlatformProvider ports={ports}>
        <VppScreenActions
          actions={[{ id: 'discover', label: 'Discover modules', type: 'plugin-command', command: 'discover' }]}
          defaultPlugin='synergy'
          deviceKey={deviceKey}
        />
      </PlatformProvider>
    )

    const { rerender } = render(tree('device-a'))
    fireEvent.click(screen.getByRole('button', { name: 'Discover modules' }))
    await waitFor(() => expect(answers).toHaveLength(1))

    // The user switched device before the answer arrived. That answer
    // describes the OLD device, so rendering it here would be wrong, not
    // merely stale.
    rerender(tree('device-b'))
    answers[0]({ ok: true, data: { modules: ['from-device-a'] } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Discover modules' })).toBeTruthy())
    expect(screen.queryByTestId('vpp-action-result-discover')).toBeNull()
  })

  it('clears results when the target device changes', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: { modules: ['AI8'] } }))
    const { rerender } = render(
      <PlatformProvider
        ports={
          {
            runtime: stubPort({ sendPluginCommand: send }),
            capabilities: stubPort(),
          } as unknown as PlatformPorts
        }
      >
        <VppScreenActions
          actions={[{ id: 'discover', label: 'Discover modules', type: 'plugin-command', command: 'discover' }]}
          defaultPlugin='synergy'
          deviceKey='device-a'
        />
      </PlatformProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Discover modules' }))
    await waitFor(() => expect(screen.getByTestId('vpp-action-result-discover')).toBeTruthy())

    rerender(
      <PlatformProvider
        ports={
          {
            runtime: stubPort({ sendPluginCommand: send }),
            capabilities: stubPort(),
          } as unknown as PlatformPorts
        }
      >
        <VppScreenActions
          actions={[{ id: 'discover', label: 'Discover modules', type: 'plugin-command', command: 'discover' }]}
          defaultPlugin='synergy'
          deviceKey='device-b'
        />
      </PlatformProvider>,
    )

    await waitFor(() => expect(screen.queryByTestId('vpp-action-result-discover')).toBeNull())
  })

  it('says so when the platform has no transport to the device', async () => {
    renderActions(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-status').textContent).toContain('cannot send commands'),
    )
  })

  it('renders nothing for a screen whose actions are all unrecognised', () => {
    const { container } = render(
      <PlatformProvider ports={{ runtime: stubPort(), capabilities: stubPort() } as unknown as PlatformPorts}>
        <VppScreenActions actions={[{ id: 'x', label: 'X', type: 'shell', command: 'rm -rf /' }]} defaultPlugin='p' />
      </PlatformProvider>,
    )

    expect(container.textContent).toBe('')
  })
})
