import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { CreateServerEditor } from '@root/frontend/store/slices/tabs/utils'

import { OpcUaServerEditor } from '../index'

let store: OpenPLCStore

const SERVER = 'OPCUA1'

const namespaceField = () => screen.getByLabelText<HTMLInputElement>('Namespace URI')

const storedNamespace = () =>
  store.getState().project.data.servers?.find((server) => server.name === SERVER)?.opcuaServerConfig?.addressSpace
    .namespaceUri

const renderEditor = () => {
  store = createTestStore()
  act(() => {
    expect(store.getState().projectActions.createServer({ data: { name: SERVER, protocol: 'opcua' } }).ok).toBe(true)
    store.getState().projectActions.updateOpcUaAddressSpaceNamespace(SERVER, 'urn:openplc:opcua:namespace')
    // The unsaved marker goes through the file slice, which opening the tab fills.
    store.getState().fileActions.addFile({ name: SERVER, type: 'server', filePath: `/servers/${SERVER}` })
    store.getState().editorActions.setEditor(CreateServerEditor(SERVER, 'opcua'))
  })
  render(<OpcUaServerEditor />, { wrapper: createStoreWrapper(store) })
}

describe('the Namespace URI in General Settings (TC30 to TC33)', () => {
  it('should show the stored Namespace URI', () => {
    renderEditor()

    expect(namespaceField().value).toBe('urn:openplc:opcua:namespace')
  })

  it('should store the new value when the field loses focus (TC30)', () => {
    renderEditor()

    fireEvent.change(namespaceField(), { target: { value: 'urn:tank:plant1' } })
    fireEvent.blur(namespaceField())

    expect(storedNamespace()).toBe('urn:tank:plant1')
  })

  it('should raise the unsaved marker when the value is stored (TC30)', () => {
    renderEditor()

    fireEvent.change(namespaceField(), { target: { value: 'urn:tank:plant1' } })
    fireEvent.blur(namespaceField())

    expect(store.getState().workspace.editingState).toBe('unsaved')
  })

  it('should store nothing before the field loses focus (TC31)', () => {
    renderEditor()

    fireEvent.change(namespaceField(), { target: { value: 'urn:tank' } })

    expect(storedNamespace()).toBe('urn:openplc:opcua:namespace')
  })

  it('should accept an empty Namespace URI (TC32)', () => {
    renderEditor()

    fireEvent.change(namespaceField(), { target: { value: '' } })
    fireEvent.blur(namespaceField())

    expect(storedNamespace()).toBe('')
  })

  it('should keep the stored value of a project saved before this change (TC33)', () => {
    renderEditor()

    expect(namespaceField().value).toBe('urn:openplc:opcua:namespace')
    expect(storedNamespace()).toBe('urn:openplc:opcua:namespace')
  })
})
