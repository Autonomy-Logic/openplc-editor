import { beforeEach, describe, expect, it } from '@jest/globals'

import type { OpcUaNodeConfig } from '../../../middleware/shared/ports/types'
import { createTestStore } from '../testing'

const permissions: OpcUaNodeConfig['permissions'] = { viewer: 'r', operator: 'r', engineer: 'rw' }

const node = (id: string, variablePath = id): OpcUaNodeConfig => ({
  id,
  pouName: 'main',
  variablePath,
  variableType: 'INT',
  nodeId: `PLC.main.${variablePath}`,
  browseName: variablePath,
  displayName: variablePath,
  description: '',
  permissions,
  nodeType: 'variable',
})

describe('batch OPC-UA address space actions', () => {
  let store: ReturnType<typeof createTestStore>

  const nodes = () =>
    store.getState().project.data.servers?.find((s) => s.name === 'OPCUA1')?.opcuaServerConfig?.addressSpace.nodes ?? []

  beforeEach(() => {
    store = createTestStore()
    store.getState().projectActions.createServer({
      data: { name: 'OPCUA1', protocol: 'opcua' },
    })
  })

  it('should start from an empty address space', () => {
    expect(nodes()).toEqual([])
  })

  it('should append every node of a batch', () => {
    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a'), node('b'), node('c')])

    expect(nodes().map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('should keep the nodes already there', () => {
    store.getState().projectActions.addOpcUaNode('OPCUA1', node('a'))

    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('b')])

    expect(nodes().map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('should never overwrite a node whose id is already there', () => {
    store.getState().projectActions.addOpcUaNode('OPCUA1', node('a', 'ORIGINAL'))

    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a', 'REPLACED')])

    expect(nodes()).toHaveLength(1)
    expect(nodes()[0].variablePath).toBe('ORIGINAL')
  })

  it('should drop a duplicate id inside the same batch', () => {
    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a', 'FIRST'), node('a', 'SECOND')])

    expect(nodes()).toHaveLength(1)
    expect(nodes()[0].variablePath).toBe('FIRST')
  })

  it('should accept an empty batch', () => {
    expect(store.getState().projectActions.addOpcUaNodes('OPCUA1', []).ok).toBe(true)
    expect(nodes()).toEqual([])
  })

  it('should report a server that does not exist', () => {
    expect(store.getState().projectActions.addOpcUaNodes('NOPE', [node('a')]).ok).toBe(false)
    expect(store.getState().projectActions.removeOpcUaNodes('NOPE', ['a']).ok).toBe(false)
  })

  it('should remove every node named in a batch', () => {
    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a'), node('b'), node('c')])

    store.getState().projectActions.removeOpcUaNodes('OPCUA1', ['a', 'c'])

    expect(nodes().map((n) => n.id)).toEqual(['b'])
  })

  it('should empty the address space when every id is named', () => {
    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a'), node('b')])

    store.getState().projectActions.removeOpcUaNodes('OPCUA1', ['a', 'b'])

    expect(nodes()).toEqual([])
  })

  it('should ignore an id that is not there', () => {
    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a')])

    store.getState().projectActions.removeOpcUaNodes('OPCUA1', ['gone'])

    expect(nodes().map((n) => n.id)).toEqual(['a'])
  })

  it('should accept an empty removal', () => {
    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a')])

    expect(store.getState().projectActions.removeOpcUaNodes('OPCUA1', []).ok).toBe(true)
    expect(nodes().map((n) => n.id)).toEqual(['a'])
  })

  it('should notify the store once for a batch add, whatever its size', () => {
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a'), node('b'), node('c'), node('d')])
    unsubscribe()

    expect(notifications).toBe(1)
  })

  it('should notify the store once for a batch removal, whatever its size', () => {
    store.getState().projectActions.addOpcUaNodes('OPCUA1', [node('a'), node('b'), node('c')])
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    store.getState().projectActions.removeOpcUaNodes('OPCUA1', ['a', 'b', 'c'])
    unsubscribe()

    expect(notifications).toBe(1)
  })
})
