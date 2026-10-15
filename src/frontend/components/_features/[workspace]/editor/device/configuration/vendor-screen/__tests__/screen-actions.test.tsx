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
    renderActions(
      recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: false, error: 'The device did not answer in time.' })),
    )

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

  it('drops the previous device answer even when the new device is asked again before it arrives', async () => {
    let answerA: (outcome: PluginCommandOutcome) => void = () => {}
    const pending = [
      new Promise<PluginCommandOutcome>((resolve) => {
        answerA = resolve
      }),
      new Promise<PluginCommandOutcome>(() => {}),
    ]
    let call = 0
    const send = recorder(() => pending[call++])
    const view = (deviceKey: string) => (
      <PlatformProvider
        ports={{ runtime: stubPort({ sendPluginCommand: send }), capabilities: stubPort() } as unknown as PlatformPorts}
      >
        <VppScreenActions
          actions={[{ id: 'discover', label: 'Discover modules', type: 'plugin-command', command: 'discover' }]}
          defaultPlugin='synergy'
          deviceKey={deviceKey}
        />
      </PlatformProvider>
    )
    const { rerender } = render(view('device-a'))

    fireEvent.click(screen.getByRole('button', { name: 'Discover modules' }))
    rerender(view('device-b'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Discover modules' }).hasAttribute('disabled')).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Discover modules' }))
    expect(send.calls).toHaveLength(2)

    answerA({ ok: true, data: { modules: ['FROM_A'] } })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByTestId('vpp-action-result-discover')).toBeNull()
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

describe('VppScreenActions module detection', () => {
  afterEach(cleanup)

  const DETECT = {
    id: 'detect_modules',
    label: 'Auto-Detect Modules',
    type: 'command',
    command: 'discover_modules',
    requiresConnection: true,
    resultMapping: { path: 'modules', slotField: 'slot', moduleIdField: 'hwId' },
  }

  function renderDetect(
    send: ((...args: unknown[]) => Promise<PluginCommandOutcome>) | undefined,
    props: Partial<React.ComponentProps<typeof VppScreenActions>>,
  ) {
    return render(
      <PlatformProvider
        ports={{ runtime: stubPort({ sendPluginCommand: send }), capabilities: stubPort() } as unknown as PlatformPorts}
      >
        <VppScreenActions actions={[DETECT]} defaultPlugin='synergy' {...props} />
      </PlatformProvider>,
    )
  }

  it('is disabled, with a reason, while no device is connected', () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: {} }))
    renderDetect(send, { connected: false, discoverySupported: true, onMappedResult: () => null })

    const button = screen.getByRole('button', { name: 'Auto-Detect Modules' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('title')).toContain('Connect to a device')
    fireEvent.click(button)
    expect(send.calls).toHaveLength(0)
  })

  it('is enabled once a device is connected', () => {
    renderDetect(undefined, { connected: true, discoverySupported: true, onMappedResult: () => null })

    const button = screen.getByRole('button', { name: 'Auto-Detect Modules' })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('title')).toBeNull()
  })

  it('is not offered when the device does not support discovery', () => {
    renderDetect(undefined, { connected: true, discoverySupported: false, onMappedResult: () => null })

    expect(screen.queryByRole('button', { name: 'Auto-Detect Modules' })).toBeNull()
  })

  it('is not offered when nothing can apply the answer', () => {
    renderDetect(undefined, { connected: true, discoverySupported: true })

    expect(screen.queryByRole('button', { name: 'Auto-Detect Modules' })).toBeNull()
  })

  it('sends nothing until the user clicks', () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: { modules: [] } }))
    renderDetect(send, { connected: true, discoverySupported: true, onMappedResult: () => null })

    expect(screen.getByRole('button', { name: 'Auto-Detect Modules' })).toBeTruthy()
    expect(send.calls).toHaveLength(0)
  })

  it('hands a successful answer to the layout instead of dumping it', async () => {
    const data = { modules: [{ slot: 1, hwId: '0x34A055EB' }], count: 1 }
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data }))
    const received: unknown[] = []
    renderDetect(send, {
      connected: true,
      discoverySupported: true,
      onMappedResult: (_action, answer) => {
        received.push(answer)
        return null
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() => expect(received).toEqual([data]))
    expect(send.calls).toEqual([[{ plugin: 'synergy', command: 'discover_modules', params: {} }]])
    expect(screen.queryByTestId('vpp-action-result-detect_modules')).toBeNull()
  })

  it('shows the error the layout returns', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: { modules: [] } }))
    renderDetect(send, {
      connected: true,
      discoverySupported: true,
      onMappedResult: () => 'The device reported modules this package does not recognise: slot 2 (0xDEADBEEF).',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-detect_modules').textContent).toContain('slot 2 (0xDEADBEEF)'),
    )
  })

  it('shows the device refusal and never reaches the layout', async () => {
    const send = recorder(() =>
      Promise.resolve<PluginCommandOutcome>({ ok: false, error: 'Stop the PLC before detecting modules.' }),
    )
    let reached = false
    renderDetect(send, {
      connected: true,
      discoverySupported: true,
      onMappedResult: () => {
        reached = true
        return null
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-detect_modules').textContent).toContain('Stop the PLC'),
    )
    expect(reached).toBe(false)
  })

  it('shows an error and frees the button when the transport rejects', async () => {
    const send = recorder(() => Promise.reject(new Error('Connection lost.')))
    renderDetect(send, { connected: true, discoverySupported: true, onMappedResult: () => null })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-detect_modules').textContent).toContain('Connection lost.'),
    )
    expect(screen.getByRole('button', { name: 'Auto-Detect Modules' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows an error and frees the button when applying the answer throws', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: { modules: [] } }))
    renderDetect(send, {
      connected: true,
      discoverySupported: true,
      onMappedResult: () => {
        throw new Error('Could not apply the detected modules.')
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Detect Modules' }))

    await waitFor(() =>
      expect(screen.getByTestId('vpp-action-result-detect_modules').textContent).toContain(
        'Could not apply the detected modules.',
      ),
    )
    expect(screen.getByRole('button', { name: 'Auto-Detect Modules' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('VppScreenActions confirmation before sending', () => {
  afterEach(cleanup)

  const TEST_ACTION = {
    id: 'self_test',
    label: 'Run self-test',
    type: 'command',
    command: 'test',
    confirm: 'The outputs will toggle during the test.',
  }

  function renderConfirm(send: (...args: unknown[]) => Promise<PluginCommandOutcome>, actions: unknown[]) {
    return render(
      <PlatformProvider
        ports={{ runtime: stubPort({ sendPluginCommand: send }), capabilities: stubPort() } as unknown as PlatformPorts}
      >
        <VppScreenActions
          actions={actions}
          defaultPlugin='synergy'
          connected
          discoverySupported
          onMappedResult={() => null}
        />
      </PlatformProvider>,
    )
  }

  it('asks first and sends nothing when the user cancels', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: {} }))
    renderConfirm(send, [TEST_ACTION])

    fireEvent.click(screen.getByRole('button', { name: 'Run self-test' }))

    expect(await screen.findByText('The outputs will toggle during the test.')).toBeTruthy()
    expect(send.calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText('The outputs will toggle during the test.')).toBeNull())
    expect(send.calls).toHaveLength(0)
  })

  it('sends once the user continues', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: { passed: true } }))
    renderConfirm(send, [TEST_ACTION])

    fireEvent.click(screen.getByRole('button', { name: 'Run self-test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByTestId('vpp-action-result-self_test')).toBeTruthy())
    expect(send.calls).toEqual([[{ plugin: 'synergy', command: 'test', params: {} }]])
  })

  it('sends without a prompt when the action declares no confirm', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: {} }))
    renderConfirm(send, [{ id: 'status', label: 'Status', type: 'command', command: 'status' }])

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))

    await waitFor(() => expect(send.calls).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('leaves the confirm of a result-mapped action to the layout, after the answer', async () => {
    const send = recorder(() => Promise.resolve<PluginCommandOutcome>({ ok: true, data: { modules: [] } }))
    renderConfirm(send, [
      {
        id: 'detect',
        label: 'Detect',
        type: 'command',
        command: 'discover_modules',
        confirm: 'Replace?',
        resultMapping: { path: 'modules', slotField: 'slot', moduleIdField: 'hwId' },
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Detect' }))

    await waitFor(() => expect(send.calls).toHaveLength(1))
    expect(screen.queryByText('Replace?')).toBeNull()
  })
})
