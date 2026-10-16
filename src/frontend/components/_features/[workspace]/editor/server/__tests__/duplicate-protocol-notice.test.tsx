/**
 * The notice a legacy project needs.
 *
 * Creating a second server of a protocol is refused, so a project holding two
 * predates the rule or was edited outside the editor. Nothing rewrites it on
 * load, which leaves the editor knowing something the user does not — unless
 * the screen says it.
 */

import { render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'

import { DuplicateProtocolNotice } from '../duplicate-protocol-notice'

let store: OpenPLCStore

const withServers = (servers: Array<{ name: string; protocol: string }>) => {
  store = createTestStore()
  const state = store.getState()
  store.setState({
    ...state,
    project: { ...state.project, data: { ...state.project.data, servers } },
  } as never)
}

describe('DuplicateProtocolNotice', () => {
  it('says nothing when the project holds one server of the protocol', () => {
    withServers([{ name: 'mb', protocol: 'modbus-tcp' }])
    const { container } = render(<DuplicateProtocolNotice name='mb' protocol='modbus-tcp' />, {
      wrapper: createStoreWrapper(store),
    })
    expect(container.innerHTML).toBe('')
  })

  it('names the sibling a legacy project carries', () => {
    withServers([
      { name: 'mb_a', protocol: 'modbus-tcp' },
      { name: 'mb_b', protocol: 'modbus-tcp' },
    ])
    render(<DuplicateProtocolNotice name='mb_a' protocol='modbus-tcp' />, { wrapper: createStoreWrapper(store) })
    expect(screen.getByText(/mb_b/)).toBeTruthy()
  })

  it('ignores a server of another protocol', () => {
    withServers([
      { name: 'mb', protocol: 'modbus-tcp' },
      { name: 's7', protocol: 's7comm' },
    ])
    const { container } = render(<DuplicateProtocolNotice name='mb' protocol='modbus-tcp' />, {
      wrapper: createStoreWrapper(store),
    })
    expect(container.innerHTML).toBe('')
  })
})
