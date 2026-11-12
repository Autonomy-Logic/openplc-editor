import { describe, expect, it } from '@jest/globals'

import type { OpcUaNodeConfig, OpcUaSecurityProfile } from '../../../middleware/shared/ports/types'
import { anonymousAccess, bulkConfirmationMessage, planBulkRemove } from '../opcua/bulk-selection'
import { GLOBAL_SCOPE_POU } from '../opcua/resolve-indices'
import { indexTree } from '../opcua/tree-index'
import type { VariableTreeNode } from '../opcua/types'

const entry = (pouName: string, name: string): VariableTreeNode => ({
  id: `${pouName}-${name}`,
  name,
  type: 'variable',
  pouName,
  variablePath: name,
  isSelectable: true,
})

const group = (pouName: string, name: string, children: VariableTreeNode[]): VariableTreeNode => ({
  id: `${pouName}-group`,
  name,
  type: pouName === GLOBAL_SCOPE_POU ? 'global' : 'program',
  pouName,
  variablePath: '',
  isSelectable: false,
  children,
})

const node = (id: string, pouName: string, variablePath: string): OpcUaNodeConfig => ({
  id,
  pouName,
  variablePath,
  variableType: 'BOOL',
  nodeId: `PLC.${pouName}.${variablePath}`,
  browseName: variablePath,
  displayName: variablePath,
  description: '',
  permissions: { viewer: 'r', operator: 'r', engineer: 'rw' },
  nodeType: 'variable',
})

const tree = (): VariableTreeNode[] => [
  group(GLOBAL_SCOPE_POU, 'GVL', [entry(GLOBAL_SCOPE_POU, 'SETPOINT')]),
  group('main', 'main', [
    entry('main', 'TANK_LEVEL'),
    entry('main', 'TANK_ALARM'),
    entry('main', 'PUMP_RUN'),
    entry(GLOBAL_SCOPE_POU, 'SETPOINT'),
  ]),
  group('aux', 'aux', [entry('aux', 'FLOW')]),
]

const exposed = (): OpcUaNodeConfig[] => [
  node('n1', GLOBAL_SCOPE_POU, 'SETPOINT'),
  node('n2', 'main', 'TANK_LEVEL'),
  node('n3', 'main', 'TANK_ALARM'),
  node('n4', 'main', 'PUMP_RUN'),
  node('n5', 'aux', 'FLOW'),
]

describe('planning a bulk removal (TC55, TC56, TC73)', () => {
  const removeFrom = (groups: VariableTreeNode[], filter = '') => {
    const full = tree()
    return planBulkRemove({ groups, index: indexTree(full), filter, existingNodes: exposed() })
  }

  it('should remove only the nodes the group owns (BR12, TC55)', () => {
    const result = removeFrom([tree()[1]])

    expect(result.nodeIds.sort()).toEqual(['n2', 'n3', 'n4'])
  })

  it('should leave a global the group only references (BR12, TC55)', () => {
    const result = removeFrom([tree()[1]])

    expect(result.nodeIds).not.toContain('n1')
  })

  it('should remove only the children the filter shows (TC73)', () => {
    const result = removeFrom([tree()[1]], 'TANK')

    expect(result.nodeIds.sort()).toEqual(['n2', 'n3'])
  })

  it('should remove every exposed node for Remove all (TC56)', () => {
    const result = removeFrom(tree())

    expect(result.nodeIds.sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
  })

  it('should remove nothing when the group owns no exposed node', () => {
    const full = tree()
    const result = planBulkRemove({
      groups: [full[2]],
      index: indexTree(full),
      filter: '',
      existingNodes: [node('n1', GLOBAL_SCOPE_POU, 'SETPOINT')],
    })

    expect(result.nodeIds).toEqual([])
  })
})

describe('the anonymous access of a server (TC58, TC59, TC62)', () => {
  const profile = (over: Partial<OpcUaSecurityProfile>): OpcUaSecurityProfile => ({
    id: 'p1',
    name: 'insecure',
    enabled: true,
    securityPolicy: 'None',
    securityMode: 'None',
    authMethods: ['Anonymous'],
    ...over,
  })

  it.each([
    ['viewer', 'Viewer', false],
    ['operator', 'Operator', false],
    ['engineer', 'Engineer', true],
  ] as const)('should read the anonymous role %s', (role, label, canWrite) => {
    const access = anonymousAccess([profile({ anonymousRole: role })])

    expect(access).toEqual({ role: label, canWrite })
  })

  it('should default an unset anonymous role to Viewer', () => {
    expect(anonymousAccess([profile({})])).toEqual({ role: 'Viewer', canWrite: false })
  })

  it('should name the most permissive role across the enabled profiles (TC59)', () => {
    const access = anonymousAccess([
      profile({ id: 'p1', anonymousRole: 'viewer' }),
      profile({ id: 'p2', name: 'commissioning', anonymousRole: 'engineer' }),
    ])

    expect(access).toEqual({ role: 'Engineer', canWrite: true })
  })

  it('should ignore a disabled profile (TC62)', () => {
    expect(anonymousAccess([profile({ enabled: false, anonymousRole: 'engineer' })])).toBeNull()
  })

  it('should ignore a profile with no Anonymous method (TC62)', () => {
    expect(anonymousAccess([profile({ authMethods: ['Username', 'Certificate'] })])).toBeNull()
  })

  it('should answer null with no profile at all (TC62)', () => {
    expect(anonymousAccess([])).toBeNull()
  })
})

describe('the bulk confirmation message (TC58, TC75)', () => {
  it('should state the count, what anonymous clients can do and the role', () => {
    const message = bulkConfirmationMessage({
      count: 9,
      access: { role: 'Viewer', canWrite: false },
      serverEnabled: true,
    })

    expect(message).toBe('Expose 9 variables? Anonymous clients can read them (role Viewer).')
  })

  it('should say read and write for a role that writes', () => {
    const message = bulkConfirmationMessage({
      count: 9,
      access: { role: 'Engineer', canWrite: true },
      serverEnabled: true,
    })

    expect(message).toBe('Expose 9 variables? Anonymous clients can read and write them (role Engineer).')
  })

  it('should add that the server is disabled (TC75)', () => {
    const message = bulkConfirmationMessage({
      count: 9,
      access: { role: 'Viewer', canWrite: false },
      serverEnabled: false,
    })

    expect(message).toBe(
      'Expose 9 variables? Anonymous clients can read them (role Viewer). The server is currently disabled.',
    )
  })

  it('should count a single variable in the singular', () => {
    const message = bulkConfirmationMessage({
      count: 1,
      access: { role: 'Viewer', canWrite: false },
      serverEnabled: true,
    })

    expect(message).toBe('Expose 1 variable? Anonymous clients can read it (role Viewer).')
  })
})

describe('planning Remove all', () => {
  const complexEntry = (pouName: string, name: string, members: string[]): VariableTreeNode => ({
    id: `${pouName}-${name}`,
    name,
    type: 'variable',
    pouName,
    variablePath: name,
    isSelectable: true,
    children: members.map((member) => ({
      id: `${pouName}-${name}.${member}`,
      name: member,
      type: 'variable' as const,
      pouName,
      variablePath: `${name}.${member}`,
      isSelectable: true,
    })),
  })

  it('should remove a node whose variable is gone from the tree', () => {
    const result = planBulkRemove({
      groups: tree(),
      index: indexTree(tree()),
      filter: '',
      existingNodes: [...exposed(), node('orphan', 'main', 'DELETED')],
      everyGroup: true,
    })

    expect(result.nodeIds).toContain('orphan')
  })

  it('should remove a member node under an exposed instance', () => {
    const withMember = [group('main', 'main', [complexEntry('main', 'fb1', ['x'])])]
    const result = planBulkRemove({
      groups: withMember,
      index: indexTree(withMember),
      filter: '',
      existingNodes: [node('m1', 'main', 'fb1.x')],
    })

    expect(result.nodeIds).toEqual(['m1'])
  })
})
