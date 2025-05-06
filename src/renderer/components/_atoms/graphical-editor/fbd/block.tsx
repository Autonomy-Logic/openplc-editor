import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { checkVariableNameUnit } from '@root/renderer/store/slices/project/validation/variables'
import type { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { FocusEvent, useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockVariant } from '../types/block'
import { buildHandle, CustomHandle } from './handle'
import { BasicNodeData, BuilderBasicProps } from './utils'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

export type BlockNodeData<T> = BasicNodeData & {
  variant: T
  executionControl: boolean
}
export type BlockNode<T> = Node<BlockNodeData<T>>
type BlockProps<T> = NodeProps<BlockNode<T>>
type BlockBuilderProps<T> = BuilderBasicProps & { variant: T; executionControl?: boolean }

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_Y = 48
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 48

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
  nodeId: string
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
    editorActions: { updateModelVariables, updateModelFBD },
    libraries,
    fbdFlows,
    fbdFlowActions: { setNodes, setEdges },
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
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => variable.name)
  const outputConnectors = blockVariables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
    .map((variable) => variable.name)

  const [blockNameValue, setBlockNameValue] = useState<string>(blockType === 'generic' ? '' : blockName)
  const [validBlockNameValue, setValidBlockNameValue] = useState<string>(blockNameValue)
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

    if (blockNameValue === blockName) {
      return
    }

    const libraryBlock = libraries.system
      // @ts-expect-error - type is dynamic
      .flatMap((block) => block.pous)
      // @ts-expect-error - type is dynamic
      .find((pou) => pou.name === blockNameValue)

    if (!libraryBlock) {
      setBlockNameValue(validBlockNameValue)
      toast({ title: 'Invalid name', description: 'The name could not be changed', variant: 'fail' })
      return
    }

    const { pou, rung, node, variables, edges } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
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
      id: `BLOCK_${crypto.randomUUID()}`,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
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

    setNodes({
      editorName: editor.meta.name,
      nodes: newNodes,
    })
    setEdges({
      editorName: editor.meta.name,
      edges: newEdges,
    })

    setWrongName(false)
  }

  const onMouseEnter = () => {
    updateModelFBD({
      hoveringElement: { elementId: nodeId, hovering: true },
    })
  }

  const onMouseLeave = () => {
    updateModelFBD({
      hoveringElement: { elementId: null, hovering: false },
    })
  }

  const handleFocusInput = (e: FocusEvent<HTMLInputElement, Element>) => {
    e.target.select()
    setValidBlockNameValue(blockNameValue)
    setInputNameFocus(true)
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
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <InputWithRef
        value={blockNameValue}
        onChange={(e) => setBlockNameValue(e.target.value.toUpperCase())}
        maxLength={20}
        placeholder='???'
        className='absolute top-2 w-full bg-transparent text-center text-xs outline-none'
        disabled={disabled}
        onFocus={handleFocusInput}
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

export const Block = <T extends object>(block: BlockProps<T>) => {
  const { data, dragging, height, width, selected, id } = block
  const {
    editor,
    project: {
      data: { pous },
    },
    projectActions: { createVariable, updateVariable },
    fbdFlows,
    fbdFlowActions: { updateNode },
  } = useOpenPLCStore()
  const {
    documentation: variantDocumentation,
    type: blockType,
    variables: blockVariables,
  } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const documentation = `${variantDocumentation}

        -- INPUT --
        ${blockVariables
          .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
          .map(
            (variable, index) =>
              `${variable.name}: ${variable.type.value}${
                index <
                blockVariables.filter((variable) => variable.class === 'input' || variable.class === 'inOut').length - 1
                  ? '\n'
                  : ''
              }`,
          )
          .join('')}

        -- OUTPUT --
          ${blockVariables
            .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
            .map(
              (variable, index) =>
                `${variable.name}: ${variable.type.value}${
                  index <
                  blockVariables.filter((variable) => variable.class === 'output' || variable.class === 'inOut')
                    .length -
                    1
                    ? '\n'
                    : ''
                }`,
            )
            .join('')}`

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

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
        case 'function-block': {
          if (!data.variable || data.variable.name === '') {
            const { variables } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
              nodeId: id,
            })
            const { name, number } = checkVariableNameUnit(
              variables.all,
              (data.variant as BlockVariant).name.toUpperCase(),
            )
            handleSubmitBlockVariableOnTextareaBlur(`${name}${number}`)
            return
          }
          inputVariableRef.current.focus()
          return
        }
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

    const { variables, node, rung } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!node || !rung) {
      console.error('Node or rung not found for ID:', id)
      return
    }

    const variable = variables.selected
    if (!variable) {
      setWrongVariable(true)
      return
    }

    if ((node.data as BasicNodeData).variable.id === variable.id) {
      if ((node.data as BasicNodeData).variable.name !== variable.name) {
        updateNode({
          editorName: editor.meta.name,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable,
            },
          },
        })
        setWrongVariable(false)
        return
      }
    }

    setWrongVariable(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitBlockVariableOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || blockVariableValue

    if (variableNameToSubmit === '') {
      setWrongVariable(true)
      return
    }

    const { rung, node, variables } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!rung || !node) {
      toast({
        title: 'Error',
        description: 'Could not find the related rung or node',
        variant: 'fail',
      })
      return
    }

    /**
     * Check if the variable exists in the table of variables
     * If exists, update the node variable
     */
    let variable: PLCVariable | undefined = variables.selected
    if (variable) {
      if (variable.name === variableNameToSubmit) return
      const res = updateVariable({
        data: {
          ...variable,
          name: variableNameToSubmit,
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
          id: crypto.randomUUID(),
          name: variableNameToSubmit,
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
      if (variable?.name !== variableNameToSubmit) {
        setBlockVariableValue(variable?.name ?? '')
      }
    }

    updateNode({
      editorName: editor.meta.name,
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
        className='absolute -top-[10px]'
        style={{
          width: width ?? DEFAULT_BLOCK_WIDTH,
        }}
      >
        {(data.variant as BlockVariant).type !== 'function' && (data.variant as BlockVariant).type !== 'generic' && (
          <HighlightedTextArea
            textAreaValue={blockVariableValue}
            setTextAreaValue={setBlockVariableValue}
            handleSubmit={handleSubmitBlockVariableOnTextareaBlur}
            onFocus={(e) => e.target.select()}
            onBlur={() => {}}
            inputHeight={{
              height: 13,
              scrollLimiter: 14,
            }}
            ref={inputVariableRef}
            textAreaClassName='text-center text-xs leading-3'
            highlightClassName='text-center text-xs leading-3'
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
 * @param position: { x: number, y: number } - The position of the block node
 * @param variant: 'template' - The type of the block node
 * @returns BlockNode
 */
export const buildBlockNode = <T extends object | undefined>({
  id,
  position,
  variant,
  executionControl = false,
}: BlockBuilderProps<T>) => {
  const { variant: variantLib, executionControl: executionControlAux } = getBlockVariantAndExecutionControl(
    { ...((variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE) },
    executionControl,
  )
  const handlePosition = {
    x: position.x,
    y: position.y + DEFAULT_BLOCK_CONNECTOR_Y,
  }
  const { handles, leftHandles, rightHandles, height, width } = getBlockSize(variantLib, handlePosition)

  return {
    id,
    type: 'block',
    position,
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

/**
 * ==== UTILITARIAN FUNCTIONS ====
 */

export const getBlockSize = (
  variant: BlockVariant,
  handlePosition: {
    x: number
    y: number
  },
) => {
  const inputConnectors = variant.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => variable.name)
  const outputConnectors = variant.variables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
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
    Math.max(variableInputWidth + 12 + variableOutputWidth, blockNameWidth),
    DEFAULT_BLOCK_WIDTH,
  )

  const leftHandles = inputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
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

  if (executionControl) {
    const executionControlVariable = variant.variables.some(
      (variable) => variable.name === 'EN' || variable.name === 'ENO',
    )

    if (!executionControlVariable) {
      variant.variables = [
        {
          name: 'EN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'ENO',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        ...variant.variables,
      ]
    }
  } else {
    variant.variables = variant.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')
  }

  return {
    variant: variant,
    executionControl: executionControl,
  }
}
