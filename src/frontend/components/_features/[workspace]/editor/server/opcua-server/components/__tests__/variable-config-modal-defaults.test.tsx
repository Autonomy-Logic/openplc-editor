import { buildDefaultNodeConfig } from '@root/frontend/utils/opcua/node-defaults'
import type { VariableTreeNode } from '@root/frontend/utils/opcua/types'
import type { OpcUaNodeConfig } from '@root/middleware/shared/ports/types'
import { describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'

import { VariableConfigModal } from '../variable-config-modal'

const node = (over: Partial<VariableTreeNode> & { id: string; name: string }): VariableTreeNode => ({
  type: 'variable',
  pouName: 'main',
  variablePath: over.name,
  isSelectable: true,
  variableType: 'INT',
  ...over,
})

function saveWithoutTouching(variable: VariableTreeNode, existingNodeIds: string[] = []): OpcUaNodeConfig {
  const onSave = jest.fn<(config: OpcUaNodeConfig) => void>()
  render(
    <VariableConfigModal
      isOpen
      onClose={() => undefined}
      onSave={onSave}
      variable={variable}
      existingNodeIds={existingNodeIds}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Add to Address Space' }))

  expect(onSave).toHaveBeenCalledTimes(1)
  return onSave.mock.calls[0][0]
}

/**
 * Characterization: bulk selection must produce exactly what the modal produces
 * when the user changes nothing, so both sides share one builder.
 */
describe('Configure OPC-UA Node, saved with no change', () => {
  it('should produce the default configuration of a scalar', () => {
    const variable = node({ id: 'main-TANK_LEVEL', name: 'TANK_LEVEL' })

    const saved = saveWithoutTouching(variable)

    expect({ ...saved, id: 'fixed' }).toEqual(buildDefaultNodeConfig(variable, () => 'fixed'))
  })

  it('should produce the default configuration of a global', () => {
    const variable = node({ id: 'GVL-SETPOINT', name: 'SETPOINT', pouName: 'GVL' })

    const saved = saveWithoutTouching(variable)

    expect({ ...saved, id: 'fixed' }).toEqual(buildDefaultNodeConfig(variable, () => 'fixed'))
  })

  it('should produce the default configuration of a function block with its members', () => {
    const variable = node({
      id: 'main-Man',
      name: 'Man',
      type: 'function_block',
      variableType: 'MotorFB',
      children: [
        node({ id: 'main-Man.Liga', name: 'Liga', variablePath: 'Man.Liga', variableType: 'BOOL' }),
        node({ id: 'main-Man.Desliga', name: 'Desliga', variablePath: 'Man.Desliga', variableType: 'BOOL' }),
      ],
    })

    const saved = saveWithoutTouching(variable)

    expect({ ...saved, id: 'fixed' }).toEqual(buildDefaultNodeConfig(variable, () => 'fixed'))
  })

  it('should produce the default configuration of an array', () => {
    const variable = node({
      id: 'main-LEVELS',
      name: 'LEVELS',
      type: 'array',
      variableType: 'INT',
      arrayInfo: { dimensions: ['1..8'], elementType: 'INT', totalLength: 8 },
    })

    const saved = saveWithoutTouching(variable)

    expect({ ...saved, id: 'fixed' }).toEqual(buildDefaultNodeConfig(variable, () => 'fixed'))
  })
})
