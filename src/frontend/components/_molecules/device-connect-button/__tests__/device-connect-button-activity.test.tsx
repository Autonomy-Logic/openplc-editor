import type { ConnectionStatus } from '@root/frontend/store/slices/device/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { DeviceConnectButton } from '../index'

type Activity = { label: string; onClick: () => void }

type ButtonProps = {
  status: ConnectionStatus
  onConnect: () => void
  onDisconnect: () => void
  activity?: Activity
}

const ACTIVITY_TEST_ID = 'device-connect-activity'
const RUNNING_LABEL = 'Installing runtime...'
const STATUSES: ConnectionStatus[] = ['disconnected', 'connecting', 'connected', 'error']

let calls: string[]

function props(status: ConnectionStatus, activity?: Activity): ButtonProps {
  return {
    status,
    onConnect: () => calls.push('connect'),
    onDisconnect: () => calls.push('disconnect'),
    activity,
  }
}

function runningActivity(): Activity {
  return { label: RUNNING_LABEL, onClick: () => calls.push('activity') }
}

function renderButton(buttonProps: ButtonProps) {
  return render(<DeviceConnectButton {...buttonProps} />)
}

describe('DeviceConnectButton with an activity', () => {
  beforeEach(() => {
    calls = []
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the activity label in place of the connection label', () => {
    renderButton(props('disconnected', runningActivity()))

    expect(screen.getByRole('button').textContent).toBe(RUNNING_LABEL)
  })

  it('marks the button that carries the activity', () => {
    renderButton(props('disconnected', runningActivity()))

    expect(screen.getByTestId(ACTIVITY_TEST_ID)).toBe(screen.getByRole('button'))
  })

  it.each(STATUSES)('stays enabled while the connection is %s', (status) => {
    renderButton(props(status, runningActivity()))

    expect(screen.getByTestId(ACTIVITY_TEST_ID).hasAttribute('disabled')).toBe(false)
  })

  it.each(STATUSES)('runs the activity on a click while the connection is %s, not connect or disconnect', (status) => {
    renderButton(props(status, runningActivity()))

    fireEvent.click(screen.getByTestId(ACTIVITY_TEST_ID))

    expect(calls).toEqual(['activity'])
  })

  it('carries no activity marker without an activity', () => {
    renderButton(props('disconnected'))

    expect(screen.queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
    expect(screen.getByRole('button').textContent).toBe('Connect')
  })

  it('goes back to the connection label and action once the activity is gone', () => {
    const view = renderButton(props('disconnected', runningActivity()))

    view.rerender(<DeviceConnectButton {...props('disconnected')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(screen.queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
    expect(calls).toEqual(['connect'])
  })
})
