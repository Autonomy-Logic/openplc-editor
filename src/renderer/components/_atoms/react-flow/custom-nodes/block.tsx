import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
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

export type BlockVariant = {
  name: string
  type: string
  variables: { name: string; class: string; type: { definition: string; value: string } }[]
  documentation: string
  extensible: boolean
}
export type BlockNodeData<T> = BasicNodeData & { variant: T; executionControl: boolean }
export type BlockNode<T> = Node<BlockNodeData<T>>
type BlockProps<T> = NodeProps<BlockNode<T>>
type BlockBuilderProps<T> = BuilderBasicProps & { variant: T; executionControl?: boolean }

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_X = DEFAULT_BLOCK_WIDTH
export const DEFAULT_BLOCK_CONNECTOR_Y = 40
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 32

export const DEFAULT_BLOCK_TYPE = {
  name: '???',
  type: 'generic',
  variables: [
    { name: '???', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: '???', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
  documentation: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam aliquam tristique tincidunt. Duis elementum
            tortor sem, non convallis orci facilisis at. Suspendisse id bibendum nisl. Mauris ac massa diam. Mauris
            ultrices massa justo, sed vehicula tellus rhoncus eget. Suspendisse lacinia nec dolor vitae sollicitudin.
            Interdum et malesuada fames ac ante ipsum primis in faucibus. Quisque rutrum, tellus eu maximus cursus,
            metus urna eleifend ex, vitae accumsan nisl neque luctus diam. Quisque vel dui vel eros lobortis maximus non
            eget mauris. Aenean aliquet, justo id tempor placerat, ipsum purus molestie justo, sed euismod est arcu
            fermentum odio. Nullam et mauris leo. Aenean magna ex, sollicitudin at consequat non, cursus nec elit. Morbi
            sodales porta elementum.`,
}

export const BlockNodeElement = <T extends object>({
  nodeId,
  data,
  disabled = false,
  height,
  selected,
  wrongVariable = false,
  scale = 1,
}: {
  nodeId?: string
  data: BlockNodeData<T>
  height: number
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
    flowActions: { updateNode, updateEdge },
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
    updateNode({
      rungId: rung.id,
      nodeId: node.id,
      node: newBlockNode,
      editorName: editor.meta.name,
    })
    edges.source?.forEach((edge) => {
      updateEdge({
        editorName: editor.meta.name,
        rungId: rung.id,
        edgeId: edge.id,
        edge: {
          ...edge,
          id: edge.id.replace(node.id, newBlockNode.id),
          source: newBlockNode.id,
          sourceHandle: newBlockNode.data.outputConnector.id,
        },
      })
    })
    edges.target?.forEach((edge) => {
      updateEdge({
        editorName: editor.meta.name,
        rungId: rung.id,
        edgeId: edge.id,
        edge: {
          ...edge,
          id: edge.id.replace(node.id, newBlockNode.id),
          target: newBlockNode.id,
          targetHandle: newBlockNode.data.inputConnector.id,
        },
      })
    })

    setWrongName(false)
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-neutral-850 bg-white text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        {
          'hover:border-transparent hover:ring-2 hover:ring-brand': !disabled,
          'border-transparent ring-2 ring-brand': selected,
          'border-transparent ring-2 ring-red-500': wrongVariable || wrongName,
        },
      )}
      style={{
        width: DEFAULT_BLOCK_WIDTH,
        height: height,
        transform: `scale(${scale})`,
      }}
    >
      <InputWithRef
        value={blockNameValue}
        onChange={(e) => setBlockNameValue(e.target.value)}
        maxLength={20}
        placeholder='???'
        className='w-full bg-transparent p-1 text-center text-sm outline-none'
        disabled={disabled}
        onFocus={() => setInputNameFocus(true)}
        onBlur={() => inputNameFocus && handleNameInputOnBlur()}
        onKeyDown={(e) => e.key === 'Enter' && inputNameRef.current?.blur()}
        ref={inputNameRef}
      />
      {inputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-sm'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 11, left: 7 }}
        >
          {connector}
        </div>
      ))}
      {outputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-sm'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 11, right: 7 }}
        >
          {connector}
        </div>
      ))}
    </div>
  )
}

export const Block = <T extends object>({ data, dragging, height, selected, id }: BlockProps<T>) => {
  const {
    editor,
    project: {
      data: { pous },
    },
    projectActions: { createVariable, updateVariable },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const { documentation, type: blockType } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputVariableRef = useRef<HTMLInputElement>(null)
  const [inputVariableFocus, setInputVariableFocus] = useState<boolean>(true)

  /**
   * useEffect to focus the variable input when the correct block type is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '' && blockType === 'function-block') {
      setBlockVariableValue(data.variable.name)
      return
    }

    if (inputVariableRef.current) {
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

    const { variables } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
    })
    const variable = variables.selected
    if (!variable && !inputVariableFocus) {
      setWrongVariable(true)
      return
    }

    if (variable && variable.name !== blockVariableValue) setBlockVariableValue(variable.name ?? '')
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
              selected={selected ?? false}
              wrongVariable={wrongVariable}
            />
          </TooltipTrigger>
          {!dragging && <TooltipContent side='right'>{documentation}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      <div
        className='absolute -top-7'
        style={{
          width: DEFAULT_BLOCK_WIDTH,
        }}
      >
        {(data.variant as BlockVariant).type !== 'function' && (data.variant as BlockVariant).type !== 'generic' && (
          <InputWithRef
            value={blockVariableValue}
            onChange={(e) => setBlockVariableValue(e.target.value)}
            placeholder='???'
            className='w-full bg-transparent text-center text-sm outline-none'
            onFocus={() => setInputVariableFocus(true)}
            onBlur={() => inputVariableFocus && handleSubmitBlockVariable()}
            onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
            ref={inputVariableRef}
          />
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
  const variantLib = { ...((variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE) }
  if (executionControl) {
    const executionControlVariable = variantLib.variables.some(
      (variable) => variable.name === 'EN' || variable.name === 'ENO',
    )
    if (!executionControlVariable) {
      variantLib.variables = [
        {
          name: 'EN',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BOOL' },
        },
        {
          name: 'ENO',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_BOOL' },
        },
        ...variantLib.variables,
      ]
    }
  } else {
    variantLib.variables = variantLib.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')
  }

  const { handles, leftHandles, rightHandles, height } = getBlockSize(variantLib, { x: handleX, y: handleY })

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
      executionControl,
    },
    width: DEFAULT_BLOCK_WIDTH,
    height,
    measured: {
      width: DEFAULT_BLOCK_WIDTH,
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
      glbX: handlePosition.x + DEFAULT_BLOCK_CONNECTOR_X,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: DEFAULT_BLOCK_CONNECTOR_X,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  const blocKHeight =
    DEFAULT_BLOCK_CONNECTOR_Y +
    Math.max(inputConnectors.length, outputConnectors.length) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  return {
    handles,
    leftHandles,
    rightHandles,
    height: DEFAULT_BLOCK_HEIGHT < blocKHeight ? blocKHeight : DEFAULT_BLOCK_HEIGHT,
  }
}
