import { FC, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addEdge,
  getConnectedEdges,
  Handle,
  Node,
  NodeProps,
  Position,
  useStore,
} from 'reactflow'

import { Dropdown } from '@/components'
import { useReactFlowElements, useToggle } from '@/hooks'
import { classNames } from '@/utils'

type PinProps = {
  id: string
  position: 'right' | 'left'
}

type PowerRailProps = {
  pins: PinProps[]
}

const PowerRail: FC<NodeProps<PowerRailProps>> = ({
  id,
  selected,
  data: { pins },
}) => {
  const HANDLE_HEIGHT = 5
  const HANDLE_SPACE = HANDLE_HEIGHT
  const POWER_RAIL_HEIGHT =
    HANDLE_HEIGHT * HANDLE_SPACE * pins.length + HANDLE_HEIGHT * HANDLE_SPACE

  const { t } = useTranslation('powerRail')

  const edgesCount = useStore((store) => store.edges.length)
  const [showDropdown, toggleShowDropdown] = useToggle(false)
  const { nodes, edges, triggerUpdate, getNode } = useReactFlowElements()

  const node = getNode(id) as Node

  const isConnectable = useCallback(() => {
    if (!node || edgesCount === 0) return

    return !(
      getConnectedEdges([node], edges).filter(
        (e) => e.source === id || e.target === id,
      ).length > 0
    )
  }, [edges, edgesCount, id, node])

  const onAuxClick = () => {
    if (!selected) return
    toggleShowDropdown()
  }

  const onCloseMenu = () => {
    toggleShowDropdown(false)
  }

  const handleAddNewPin = useCallback(() => {
    const [connectedNode] = getConnectedEdges([node], edges).filter(
      (e) => e.source === id || e.target === id,
    )
    const connectedNodeId =
      connectedNode.target !== id ? connectedNode.target : connectedNode.source

    const sourceHandleId = crypto.randomUUID()
    const targetHandleId = crypto.randomUUID()

    triggerUpdate(
      'nodes',
      nodes.map((node) => {
        if (node.id === id) {
          node.data.pins = [
            ...node.data.pins,
            {
              id: sourceHandleId,
              position: node.data.pins[0].position,
            },
          ]
        }
        if (connectedNodeId === node.id) {
          node.data.pins = [
            ...node.data.pins,
            {
              id: targetHandleId,
              position: node.data.pins[0].position,
            },
          ]
        }
        return node
      }),
    )

    triggerUpdate(
      'edges',
      addEdge(
        {
          id: crypto.randomUUID(),
          type: 'default',
          source: id,
          target: connectedNodeId,
          sourceHandle: sourceHandleId,
          targetHandle: targetHandleId,
        },
        edges,
      ),
    )
  }, [edges, id, node, nodes, triggerUpdate])

  useEffect(() => {
    console.log('edges ->', nodes)
  }, [nodes])
  return (
    <Dropdown
      show={showDropdown}
      onAuxClick={onAuxClick}
      onClose={onCloseMenu}
      options={[
        {
          label: t('addPin'),
          onClick: handleAddNewPin,
        },
      ]}
    >
      <div
        role="button"
        tabIndex={0}
        className={classNames(
          'flex h-full w-1 flex-col justify-between rounded bg-black',
          selected && 'border border-open-plc-blue',
        )}
        style={{ minHeight: POWER_RAIL_HEIGHT }}
      >
        {pins.map(({ id, position }, index) => (
          <Handle
            key={id}
            id={id}
            type="source"
            isConnectable={isConnectable()}
            position={Position[position === 'right' ? 'Right' : 'Left']}
            style={{ top: (index + 1) * (HANDLE_HEIGHT * HANDLE_SPACE) }}
            className={classNames(
              'h-[0.125rem] min-h-0 w-6 rounded-none bg-black',
              position === 'right' ? '-right-6' : '-left-6',
              selected ? 'border border-open-plc-blue' : 'border-none',
            )}
          />
        ))}
      </div>
    </Dropdown>
  )
}

export default PowerRail
