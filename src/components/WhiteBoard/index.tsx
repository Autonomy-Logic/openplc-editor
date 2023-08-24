import { CONSTANTS } from '@shared/constants'
import {
  DragEvent,
  FC,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { IconType } from 'react-icons'
import { BiLockAlt, BiLockOpenAlt } from 'react-icons/bi'
import { CgRedo, CgUndo } from 'react-icons/cg'
import { HiMinusSmall, HiPlusSmall } from 'react-icons/hi2'
import { MdFullscreen } from 'react-icons/md'
import ReactFlow, {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  ConnectionMode,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  ReactFlowInstance,
  SelectionMode,
  useStore,
} from 'reactflow'
import { gray } from 'tailwindcss/colors'

import { useReactFlowElements, useTheme, useToggle } from '@/hooks'
import { classNames } from '@/utils'

import Tooltip from '../Tooltip'
import { DefaultEdge } from './edges'
import { Comment, PowerRail } from './nodes'
/**
 * Type for individual control items.
 */
export type ControlsProps = {
  id: number
  icon: IconType
  className?: string
  onClick?: () => void
  tooltip: string
  divider?: boolean
  disabled?: boolean
}
/**
 * Type for custom controls container.
 */
export type CustomControlsProps = {
  controls: ControlsProps[]
  className: string
}
/**
 * Destructure the `variants` property from the `theme` object in `CONSTANTS`.
 */
const {
  theme: { variants },
} = CONSTANTS
/**
 * Definition of node types for the React Flow component.
 */
const NODE_TYPES = {
  // Node type for comments.
  comment: Comment,
  // Node type for power rails.
  powerRail: PowerRail,
}
/**
 * Definition of edge types for the React Flow component.
 */
const EDGE_TYPES = {
  default: DefaultEdge,
}
/**
 * Component for rendering custom controls.
 *
 * @returns a JSX component with the custom controls
 */
const CustomControls: FC<CustomControlsProps> = ({ controls, className }) => {
  return (
    <div
      className={classNames(
        'absolute z-10 m-4 flex items-center gap-2 rounded-lg bg-white p-3 shadow-lg dark:bg-gray-900',
        className,
      )}
    >
      {controls.map(
        ({
          id,
          onClick,
          icon: Icon,
          className,
          tooltip,
          divider,
          disabled,
        }) => (
          <Fragment key={id}>
            <Tooltip id={tooltip} label={tooltip} place="bottom">
              <button
                className="press-animated border-none outline-none"
                onClick={() => onClick && onClick()}
                disabled={disabled}
              >
                <Icon
                  className={classNames(
                    'h-6 w-6',
                    disabled
                      ? 'text-gray-300'
                      : 'text-gray-400 hover:opacity-90',
                    !!className && className,
                  )}
                />
              </button>
            </Tooltip>
            {divider && <div className="h-6 w-[1px] bg-gray-300" />}
          </Fragment>
        ),
      )}
    </div>
  )
}
/**
 * Component for rendering the whiteboard.
 *
 * @returns a JSX component with the whiteboard mounted
 */
const WhiteBoard: FC = () => {
  // Get the translation function from the i18next library.
  const { t } = useTranslation('controls')
  // Destructuring variables from the result of the `useReactFlowElements` hook.
  const { nodes, edges, undo, redo, canRedo, canUndo, triggerUpdate } =
    useReactFlowElements()

  const width = useStore(({ width }) => width)
  const height = useStore(({ height }) => height)

  const defaultViewport = { x: 0, y: 0, zoom: 0 }
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null)

  const { theme } = useTheme()
  const [interactivity, toggleInteractivity] = useToggle(true)

  // Event handles
  const handleUndo = () => canUndo && undo()

  const handleRedo = () => canRedo && redo()

  // Control item definitions
  const actionsControls: ControlsProps[] = [
    {
      id: 0,
      onClick: handleUndo,
      icon: CgUndo,
      tooltip: t('undo'),
      divider: true,
      disabled: !canUndo,
    },
    {
      id: 1,
      onClick: handleRedo,
      icon: CgRedo,
      tooltip: t('redo'),
      disabled: !canRedo,
    },
  ]
  const zoomControls: ControlsProps[] = [
    {
      id: 0,
      onClick: () => reactFlowInstance?.zoomOut({ duration: 300 }),
      icon: HiMinusSmall,
      tooltip: t('zoomOut'),
      divider: true,
    },
    {
      id: 1,
      onClick: () => reactFlowInstance?.zoomIn({ duration: 300 }),
      icon: HiPlusSmall,
      tooltip: t('zoomIn'),
    },
  ]
  const whiteboardControls: ControlsProps[] = [
    {
      id: 0,
      onClick: () => reactFlowInstance?.fitView(),
      icon: MdFullscreen,
      tooltip: t('fitView'),
    },
    {
      id: 1,
      onClick: toggleInteractivity,
      icon: interactivity ? BiLockOpenAlt : BiLockAlt,
      tooltip: t('toggleInteractivity'),
    },
  ]

  // Use effects hooks
  useEffect(() => {
    reactFlowInstance?.fitView()
  }, [height, reactFlowInstance, width])

  useEffect(() => {
    reactFlowInstance?.zoomTo(0)
  }, [reactFlowInstance])

  /**
   * Callback for handling changes to nodes.
   *
   * @param changes - Array of node changes.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const ignoreAction = !!changes.find(
        ({ type }) =>
          type === 'select' || type === 'position' || type === 'dimensions',
      )
      triggerUpdate(
        'nodes',
        applyNodeChanges(changes, nodes),
        undefined,
        ignoreAction,
      )
    },
    [nodes, triggerUpdate],
  )

  /**
   * Callback for handling changes to edges.
   *
   * @param changes - Array of edge changes.
   */
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const ignoreAction = !!changes.find(({ type }) => type === 'select')
      triggerUpdate(
        'edges',
        applyEdgeChanges(changes, edges),
        undefined,
        ignoreAction,
      )
    },
    [triggerUpdate, edges],
  )

  /**
   * Callback for handling new connections.
   *
   * @param connection - The new connection.
   */
  const onConnect = useCallback(
    (connection: Connection) => {
      triggerUpdate('edges', addEdge(connection, edges))
    },
    [triggerUpdate, edges],
  )

  /**
   * Callback for handling edge deletion.
   *
   * @param edges - The deleted edges.
   */
  const onEdgesDelete = useCallback(
    ([edge]: Edge[]) => {
      const target = nodes.find(({ id }) => edge.target === id) as Node
      const source = nodes.find(({ id }) => edge.source === id) as Node

      if (target.type === 'powerRail' && source.type === 'powerRail') {
        triggerUpdate(
          'nodes',
          nodes.map((node) => {
            if (node.id === source.id) {
              node.data.pins = node.data.pins.filter(
                ({ id }: Node<'powerRail'>) => id !== edge.sourceHandle,
              )
            }
            if (node.id === target.id) {
              node.data.pins = node.data.pins.filter(
                ({ id }: Node<'powerRail'>) => id !== edge.targetHandle,
              )
            }
            return node
          }),
        )
      }
    },
    [nodes, triggerUpdate],
  )

  /**
   * Callback for handling drag over event.
   *
   * @param event - The drag event.
   */
  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  /**
   * Callback for handling drop event.
   *
   * @param event - The drop event.
   */
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (!reactFlowInstance || !reactFlowWrapper.current) return

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect()
      const type = event.dataTransfer.getData('application/reactflow')

      if (typeof type === 'undefined' || !type) {
        return
      }

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      })
      const newNode = {
        id: crypto.randomUUID(),
        type,
        position,
        data: { label: `${type} node` },
      }

      triggerUpdate('nodes', nodes.concat(newNode))
    },
    [nodes, reactFlowInstance, triggerUpdate],
  )

  return (
    <div className="reactflow-wrapper h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodes={nodes}
        edges={edges}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodesChange={onNodesChange}
        connectionMode={ConnectionMode.Loose}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        defaultViewport={defaultViewport}
        // onNodeDragStop={(e) => console.log('onNodeDragStop ->', e)}
        nodesDraggable={interactivity}
        nodesConnectable={interactivity}
        elementsSelectable={interactivity}
        panOnScroll
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        fitView
        defaultEdgeOptions={{
          type: 'default',
        }}
      >
        <Background
          gap={12}
          size={2}
          color={theme === variants.DARK ? gray[600] : gray[300]}
        />
        {/* Custom control components */}
        <CustomControls className="" controls={actionsControls} />
        <CustomControls className="right-0" controls={zoomControls} />
        <CustomControls
          className="right-32 gap-3"
          controls={whiteboardControls}
        />
      </ReactFlow>
    </div>
  )
}

export default WhiteBoard
