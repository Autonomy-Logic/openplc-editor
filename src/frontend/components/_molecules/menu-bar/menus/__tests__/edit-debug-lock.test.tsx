import * as MenuPrimitive from '@radix-ui/react-menubar'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'

import type { OpenPLCStore } from '../../../../../store'
import { EditMenu } from '../edit'

let store: OpenPLCStore

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

// Radix's trigger opens on Enter, so the test needs no PointerEvent.
const openMenu = () => {
  const StoreWrapper = createStoreWrapper(store)
  const wrapper = ({ children }: { children: ReactNode }) => <StoreWrapper>{children}</StoreWrapper>
  render(
    <MenuPrimitive.Root>
      <EditMenu />
    </MenuPrimitive.Root>,
    { wrapper },
  )
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /edit/i }), { key: 'Enter' })
}

const deleteItem = () => screen.getByRole('menuitem', { name: /delete/i })

const deleteConfirmationIsOpen = () => store.getState().modals['confirm-delete-element'].open

describe('the in-app Edit menu during a debug session (TC06)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should offer Delete element while no debug session is open', () => {
    openMenu()

    expect(deleteItem().getAttribute('data-disabled')).toBeNull()
  })

  it('should show Delete element disabled while the debugger is open', () => {
    openDebugSession()
    openMenu()

    expect(deleteItem().getAttribute('data-disabled')).not.toBeNull()
  })

  it('should open no delete confirmation when the disabled item is clicked', () => {
    openDebugSession()
    openMenu()

    fireEvent.click(deleteItem())

    expect(deleteConfirmationIsOpen()).toBe(false)
  })

  it('should open the delete confirmation once the debug session is closed', () => {
    openDebugSession()
    closeDebugSession()
    openMenu()

    fireEvent.click(deleteItem())

    expect(deleteConfirmationIsOpen()).toBe(true)
  })
})
