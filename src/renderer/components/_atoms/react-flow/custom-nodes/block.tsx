import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { updateDiagramElementsPosition } from '@root/renderer/components/_molecules/rung/ladder-utils/elements/diagram'
// import { updateVariableBlockPosition } from '@root/renderer/components/_molecules/rung/ladder-utils/elements/variable-block'
import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'
//
export type BlockVariant = {
  name: string
  type: string
  variables: { name: string; class: string; type: { definition: string; value: string } }[]
  documentation: string
  extensible: boolean
}
type variables = {
  [key: string]: {
    variable: PLCVariable | undefined
    type: 'input' | 'output'
  }
}

export type BlockNodeData<T> = BasicNodeData & {
  variant: T
  executionControl: boolean
  lockExecutionControl: boolean
  connectedVariables: variables
}
export type BlockNode<T> = Node<BlockNodeData<T>>
type BlockProps<T> = NodeProps<BlockNode<T>>
type BlockBuilderProps<T> = BuilderBasicProps & { variant: T; executionControl?: boolean }

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_Y = 36
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 40

export const DEFAULT_BLOCK_TYPE = {
  name: '???',
  type: 'generic',
  variables: [
    { name: '???', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: '???', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
  documentation: '',
}

export const BlockNodeElement = <T extends object>({
  nodeId,
  data,
  disabled = false,
  height,
  width,
  selected,
  wrongVariable = false,
  scale = 1,
}: {
  nodeId?: string
  data: BlockNodeData<T>
  height: number
  width: number
  selected: boolean
  disabled?: boolean
  wrongVariable?: boolean
  scale?: number
}) => {
  const {
    editor,
    editorActions: { updateModelVariables },
    libraries,
    flows,
    flowActions: { setNodes, setEdges },
    project: {
      data: { pous },
    },
    projectActions: { updateVariable, deleteVariable },
  } = useOpenPLCStore()

  const {
    name: blockName,
    variables: blockVariables,
    type: blockType,
  } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE

  const inputConnectors = blockVariables
    .filter((variable) => variable.class === 'input')
    .map((variable) => variable.name)
  const outputConnectors = blockVariables
    .filter((variable) => variable.class === 'output')
    .map((variable) => variable.name)

  const [blockNameValue, setBlockNameValue] = useState<string>(blockType === 'generic' ? '' : blockName)
  const [wrongName, setWrongName] = useState<boolean>(false)

  const inputNameRef = useRef<HTMLInputElement>(null)
  const [inputNameFocus, setInputNameFocus] = useState<boolean>(true)

  /**
   * useEffect to focus the name input when the correct block type is selected
   */
  useEffect(() => {
    if (disabled) return

    if (inputNameRef.current) {
      switch (blockType) {
        case 'generic':
          inputNameRef.current.focus()
          break
        default:
          break
      }
    }
  }, [])

  /**
   * In case the block is disabled, we need to set the block name value to the block name
   */
  useEffect(() => {
    if (disabled) {
      setBlockNameValue(blockName)
      return
    }
  }, [data])

  const handleNameInputOnBlur = () => {
    setInputNameFocus(false)

    if (blockNameValue === '' || blockNameValue === blockName) {
      return
    }

    let libraryBlock: unknown = undefined
    libraries.system.find((block) =>
      block.pous.find((pou) => {
        if (pou.name === blockNameValue) {
          libraryBlock = pou
          return true
        }
        return
      }),
    ) || undefined
    if (!libraryBlock) {
      setWrongName(true)
      return
    }

    const { pou, rung, node, variables, edges } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: nodeId ?? '',
    })
    if (!pou || !rung || !node) return

    if (libraryBlock && pou.type === 'function' && (libraryBlock as BlockVariant).type !== 'function') {
      setWrongName(true)
      toast({
        title: 'Can not add block',
        description: `You can not add a ${(libraryBlock as BlockVariant).type} block to an function POU`,
        variant: 'fail',
      })
      return
    }

    let variable = variables.selected
    const variableIndex = variable ? variables.all.indexOf(variable) : -1

    if (variable) {
      let res: { ok: boolean; data?: unknown; message?: string; title?: string } = {
        ok: true,
        data: undefined,
        message: '',
        title: '',
      }

      if ((libraryBlock as BlockVariant).type !== 'function-block') {
        deleteVariable({
          rowId: variableIndex,
          scope: 'local',
          associatedPou: editor.meta.name,
        })
        if (
          editor.type === 'plc-graphical' &&
          editor.variable.display === 'table' &&
          parseInt(editor.variable.selectedRow) === variableIndex
        ) {
          updateModelVariables({ display: 'table', selectedRow: -1 })
        }
        variable = undefined
      } else {
        res = updateVariable({
          data: {
            type: {
              definition: 'derived',
              value: blockNameValue,
            },
          },
          rowId: variableIndex,
          scope: 'local',
          associatedPou: editor.meta.name,
        })
        if (!res.ok) {
          toast({
            title: res.title,
            description: res.message,
            variant: 'fail',
          })
          return
        }
        variable = res.data as PLCVariable | undefined
      }
    }

    let newNodes = [...rung.nodes]
    let newEdges = [...rung.edges]

    /**
     * Update the node with the new block node
     * The new block node have a new ID to not conflict with the old block node and to no occur any error of rendering
     */
    const newBlockNode = buildBlockNode({
      id: `BLOCK_${uuidv4()}`,
      posX: node.position.x,
      posY: node.position.y,
      handleX: (node.data as BasicNodeData).handles[0].glbPosition.x,
      handleY: (node.data as BasicNodeData).handles[0].glbPosition.y,
      variant: libraryBlock,
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })
    newBlockNode.data = {
      ...newBlockNode.data,
      variable: variable ?? { name: '' },
    }

    newNodes = newNodes.map((n) => (n.id === node.id ? newBlockNode : n))

    edges.source?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        source: newBlockNode.id,
        sourceHandle: newBlockNode.data.outputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })
    edges.target?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        target: newBlockNode.id,
        targetHandle: newBlockNode.data.inputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })

    const { nodes: variableNodes, edges: variableEdges } = updateDiagramElementsPosition(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
      },
      [rung.defaultBounds[0], rung.defaultBounds[1]],
    )

    setNodes({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodes: variableNodes,
    })
    setEdges({
      editorName: editor.meta.name,
      rungId: rung.id,
      edges: variableEdges,
    })

    setWrongName(false)
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-neutral-850 bg-white text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        {
          'hover:border-transparent hover:ring-2 hover:ring-brand': !disabled,
          'border-transparent ring-1 ring-red-500': wrongVariable || wrongName,
          'border-transparent ring-2 ring-brand': selected,
        },
      )}
      style={{
        width: width,
        height: height,
        transform: `scale(${scale})`,
      }}
    >
      <InputWithRef
        value={blockNameValue}
        onChange={(e) => setBlockNameValue(e.target.value.toUpperCase())}
        maxLength={20}
        placeholder='???'
        className='w-full bg-transparent p-1 text-center text-xs outline-none'
        disabled={disabled}
        onFocus={() => setInputNameFocus(true)}
        onBlur={() => inputNameFocus && handleNameInputOnBlur()}
        onKeyDown={(e) => e.key === 'Enter' && inputNameRef.current?.blur()}
        ref={inputNameRef}
      />
      {inputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 10, left: 6 }}
        >
          {connector}
        </div>
      ))}
      {outputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 10, right: 6 }}
        >
          {connector}
        </div>
      ))}
    </div>
  )
}

export const Block = <T extends object>({ data, dragging, height, width, selected, id }: BlockProps<T>) => {
  const {
    editor,
    project: {
      data: { pous },
    },
    projectActions: { createVariable, updateVariable },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()
  const {
    documentation: variantDocumentation,
    type: blockType,
    variables: blockVariables,
  } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const documentation = `${variantDocumentation}

        -- INPUT --
        ${blockVariables
          .filter((variable) => variable.class === 'input')
          .map(
            (variable, index) =>
              `${variable.name}: ${variable.type.value}${
                index < blockVariables.filter((variable) => variable.class === 'input').length - 1 ? '\n' : ''
              }`,
          )
          .join('')}

        -- OUTPUT --
          ${blockVariables
            .filter((variable) => variable.class === 'output')
            .map(
              (variable, index) =>
                `${variable.name}: ${variable.type.value}${
                  index < blockVariables.filter((variable) => variable.class === 'output').length - 1 ? '\n' : ''
                }`,
            )
            .join('')}`

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputVariableRef = useRef<HTMLTextAreaElement>(null)
  const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
  const [inputVariableFocus, setInputVariableFocus] = useState<boolean>(true)

  useEffect(() => {
    if (inputVariableRef.current) {
      inputVariableRef.current.style.height = 'auto'
      inputVariableRef.current.style.height = `${inputVariableRef.current.scrollHeight < 26 ? inputVariableRef.current.scrollHeight : 13}px`
      if (scrollableIndicatorRef.current)
        scrollableIndicatorRef.current.style.display = inputVariableRef.current.scrollHeight > 26 ? 'block' : 'none'
    }
  }, [blockVariableValue])

  /**
   * useEffect to focus the variable input when the correct block type is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '' && blockType === 'function-block') {
      setBlockVariableValue(data.variable.name)
      return
    }

    if (inputVariableRef.current && selected) {
      switch (blockType) {
        case 'function-block':
          inputVariableRef.current.focus()
          break
        default:
          break
      }
    }
  }, [data])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    if (blockType !== 'function-block') {
      setWrongVariable(false)
      return
    }

    const { variables, node, rung } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
    })
    const variable = variables.selected
    if (!variable && !inputVariableFocus) {
      setWrongVariable(true)
      return
    }

    if (variable && node && rung && node.data.variable !== variable) {
      setBlockVariableValue(variable.name)
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable,
          },
        },
      })
    }
    setWrongVariable(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitBlockVariable = () => {
    setInputVariableFocus(false)

    if (blockVariableValue === '') {
      setWrongVariable(true)
      return
    }

    const { rung, node, variables } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
    })
    if (!rung || !node) return

    /**
     * Check if the variable exists in the table of variables
     * If exists, update the node variable
     */
    let variable: PLCVariable | undefined = variables.selected
    if (variable) {
      if (variable.name === blockVariableValue) return
      const res = updateVariable({
        data: {
          ...variable,
          name: blockVariableValue,
          type: {
            definition: 'derived',
            value: (node.data as BlockNodeData<BlockVariant>).variant.name,
          },
        },
        rowId: variables.all.indexOf(variable),
        scope: 'local',
        associatedPou: editor.meta.name,
      })
      if (!res.ok) {
        toast({
          title: res.title,
          description: res.message,
          variant: 'fail',
        })
        setBlockVariableValue(variable.name)
        return
      }
      variable = res.data as PLCVariable | undefined
    } else {
      const res = createVariable({
        data: {
          id: uuidv4(),
          name: blockVariableValue,
          type: {
            definition: 'derived',
            value: (node.data as BlockNodeData<BlockVariant>).variant.name,
          },
          class: 'local',
          location: '',
          documentation: '',
          debug: false,
        },
        scope: 'local',
        associatedPou: editor.meta.name,
      })
      if (!res.ok) {
        toast({
          title: res.title,
          description: res.message,
          variant: 'fail',
        })
        return
      }
      variable = res.data as PLCVariable | undefined
      if (variable?.name !== blockVariableValue) {
        setBlockVariableValue(variable?.name ?? '')
      }
    }

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: node.id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: variable ?? { name: '' },
        },
      },
    })
    setWrongVariable(false)
  }

  return (
    <div
      className={cn('relative', {
        'opacity-40': id.startsWith('copycat'),
      })}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <BlockNodeElement
              nodeId={id}
              data={data}
              height={height ?? DEFAULT_BLOCK_HEIGHT}
              width={width ?? DEFAULT_BLOCK_WIDTH}
              selected={selected ?? false}
              wrongVariable={wrongVariable}
            />
          </TooltipTrigger>
          {!dragging && blockType !== 'generic' && documentation && (
            <TooltipContent side='right' className='text-xs'>
              <span className='whitespace-pre-line'>{documentation}</span>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <div
        className='absolute -top-4'
        style={{
          width: width ?? DEFAULT_BLOCK_WIDTH,
        }}
      >
        {(data.variant as BlockVariant).type !== 'function' && (data.variant as BlockVariant).type !== 'generic' && (
          <div className='flex w-full flex-row'>
            <textarea
              value={blockVariableValue}
              onChange={(e) => setBlockVariableValue(e.target.value)}
              placeholder='???'
              className='w-full resize-none bg-transparent text-center text-xs leading-3 outline-none [&::-webkit-scrollbar]:hidden'
              onFocus={() => setInputVariableFocus(true)}
              onBlur={() => {
                if (inputVariableRef.current) inputVariableRef.current.scrollTop = 0
                inputVariableFocus && handleSubmitBlockVariable()
              }}
              onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
              ref={inputVariableRef}
              rows={1}
              spellCheck={false}
            />
            <div className={cn('pointer-events-none text-cp-sm')} ref={scrollableIndicatorRef}>
              ↕
            </div>
          </div>
        )}
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
  )
}

/**
 *
 * @param id: string - The id of the block node
 * @param posX: number - The x coordinate of the block node in the flow panel
 * @param posY: number - The y coordinate of the block node in the flow panel
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @param blockType: 'template' - The type of the block node
 * @returns BlockNode
 */
export const buildBlockNode = <T extends object | undefined>({
  id,
  posX,
  posY,
  handleX,
  handleY,
  variant,
  executionControl = false,
}: BlockBuilderProps<T>) => {
  const {
    variant: variantLib,
    executionControl: executionControlAux,
    lockExecutionControl,
  } = getBlockVariantAndExecutionControl({ ...((variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE) }, executionControl)
  const { handles, leftHandles, rightHandles, height, width } = getBlockSize(variantLib, { x: handleX, y: handleY })

  return {
    id,
    type: 'block',
    position: { x: posX, y: posY },
    data: {
      handles,
      inputHandles: leftHandles,
      outputHandles: rightHandles,
      inputConnector: leftHandles[0],
      outputConnector: rightHandles[0],
      numericId: generateNumericUUID(),
      variant: variantLib,
      variable: { name: '' },
      executionOrder: 0,
      executionControl: executionControlAux,
      lockExecutionControl,
      connectedVariables: {},
      draggable: true,
      selectable: true,
      deletable: true,
    },
    width,
    height,
    measured: {
      width,
      height,
    },
    draggable: true,
    selectable: true,
    selected: variantLib.type === 'function' ? false : true,
  }
}

export const getBlockSize = (
  variant: BlockVariant,
  handlePosition: {
    x: number
    y: number
  },
) => {
  const inputConnectors = variant.variables
    .filter((variable) => variable.class === 'input')
    .map((variable) => variable.name)
  const outputConnectors = variant.variables
    .filter((variable) => variable.class === 'output')
    .map((variable) => variable.name)

  const blockHeight =
    DEFAULT_BLOCK_CONNECTOR_Y +
    24 +
    Math.max(inputConnectors.length - 1, outputConnectors.length - 1) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  let variableInputWidth = 0
  let variableOutputWidth = 0
  const blockNameWidth = variant.name.length * 12
  inputConnectors.forEach((input) => {
    const inputWidth = input.length * 12
    if (inputWidth > variableInputWidth) variableInputWidth = inputWidth
  })
  outputConnectors.forEach((output) => {
    const outputWidth = output.length * 12
    if (outputWidth > variableOutputWidth) variableOutputWidth = outputWidth
  })

  const blockWidth = Math.min(
    Math.max(variableInputWidth + 18 + variableOutputWidth, blockNameWidth),
    DEFAULT_BLOCK_WIDTH,
  )

  const leftHandles = inputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handlePosition.x,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: 0,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        left: 0,
      },
    }),
  )

  const rightHandles = outputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handlePosition.x + blockWidth,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: blockWidth,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  return {
    handles,
    leftHandles,
    rightHandles,
    height: blockHeight,
    width: blockWidth,
  }
}

const getBlockVariantAndExecutionControl = (variantLib: BlockVariant, executionControl: boolean) => {
  const variant = { ...variantLib }

  const inputConnectors = variant.variables
    .filter((variable) => variable.class === 'input')
    .map((variable) => ({
      name: variable.name,
      type: variable.type,
    }))
  const outputConnectors = variant.variables
    .filter((variable) => variable.class === 'output')
    .map((variable) => ({
      name: variable.name,
      type: variable.type,
    }))

  const mustHaveExecutionControlEnabled =
    inputConnectors[0].type.value !== 'BOOL' || outputConnectors[0].type.value !== 'BOOL'

  if (executionControl || mustHaveExecutionControlEnabled) {
    const executionControlVariable = variant.variables.some(
      (variable) => variable.name === 'EN' || variable.name === 'ENO',
    )

    if (!executionControlVariable) {
      variant.variables = [
        {
          name: 'EN',
          class: 'input',
          type: { definition: 'generic-type', value: 'BOOL' },
        },
        {
          name: 'ENO',
          class: 'output',
          type: { definition: 'generic-type', value: 'BOOL' },
        },
        ...variant.variables,
      ]
    }
  } else {
    variant.variables = variant.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')
  }

  return {
    variant: variant,
    executionControl: executionControl || mustHaveExecutionControlEnabled,
    lockExecutionControl: mustHaveExecutionControlEnabled,
  }
}
