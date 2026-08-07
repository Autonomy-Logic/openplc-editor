/**
 * One Connect button serves both target families. These pin the behaviour that
 * had drifted between the two hand-written copies: the label, when the button is
 * disabled, and whether a connection is confirmed on screen at all.
 */
import { fireEvent, render, screen } from '@testing-library/react'

import { DeviceConnectButton } from '../index'

describe('DeviceConnectButton', () => {
  it('reads Connect when disconnected and calls onConnect', () => {
    const onConnect = jest.fn()
    const onDisconnect = jest.fn()
    render(<DeviceConnectButton status='disconnected' onConnect={onConnect} onDisconnect={onDisconnect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('reads Disconnect when connected and calls onDisconnect', () => {
    const onConnect = jest.fn()
    const onDisconnect = jest.fn()
    render(<DeviceConnectButton status='connected' onConnect={onConnect} onDisconnect={onDisconnect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('says Disconnect when connected, and nothing else', () => {
    // The label IS the status: "Disconnect" can only appear while connected, so a
    // separate "Connected" badge beside it was saying the same thing twice — and on
    // the device screen it sat next to the licence badge, making the row read as
    // three separate facts when it is two.
    render(<DeviceConnectButton status='connected' onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect(screen.getByRole('button').textContent).toBe('Disconnect')
    expect(screen.queryByText(/Connected/)).toBeNull()
  })

  it('reports a failed attempt', () => {
    render(<DeviceConnectButton status='error' onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect(screen.getByText('● Connection failed')).not.toBeNull()
  })

  it('is inert while connecting', () => {
    render(<DeviceConnectButton status='connecting' onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect((screen.getByRole('button', { name: 'Connecting...' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains itself when something blocks connecting', () => {
    render(
      <DeviceConnectButton
        status='disconnected'
        onConnect={jest.fn()}
        onDisconnect={jest.fn()}
        blockedReason='Select a communication port first'
      />,
    )

    const button = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Select a communication port first')
  })

  it('stays live when nothing blocks it, so resolution can report the real reason', () => {
    render(<DeviceConnectButton status='disconnected' onConnect={jest.fn()} onDisconnect={jest.fn()} />)
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders caller-supplied detail beside the status', () => {
    render(
      <DeviceConnectButton status='connected' onConnect={jest.fn()} onDisconnect={jest.fn()}>
        <span>| PLC: RUNNING</span>
      </DeviceConnectButton>,
    )
    expect(screen.getByText('| PLC: RUNNING')).not.toBeNull()
  })
})
