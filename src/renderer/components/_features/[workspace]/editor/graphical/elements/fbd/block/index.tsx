import * as Switch from '@radix-ui/react-switch'
import { InputWithRef } from '@root/renderer/components/_atoms'
import {
  BlockNode,
  BlockNodeData,
  BlockNodeElement,
  buildBlockNode,
  getBlockSize,
} from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils/types'
import { getFBDPouVariablesRungNodeAndEdges } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils/utils'
import { BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/types/block'
import {
  getBlockDocumentation,
  getVariableRestrictionType,
} from '@root/renderer/components/_atoms/graphical-editor/utils'
import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'
import { EditorModel, LibraryState } from '@root/renderer/store/slices'
import { PLCPou } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import ArrowButtonGroup from '../../arrow-button-group'
import { ModalBlockLibrary } from './library'

type BlockElementProps<T> = {
  isOpen: boolean
  onClose?: () => void
  selectedNode: BlockNode<T>
}

const searchLibraryByPouName = (
  libraries: LibraryState['libraries'],
  editor: EditorModel,
  pous: PLCPou[],
  pouName: string,
) => {
  let libraryBlock: unknown = undefined

  const filteredLibraries = libraries.system.filter((library) =>
    pous.find((pou) => pou.data.name === editor.meta.name)?.type === 'function'
      ? library.pous.some((pou) => pou.type === 'function')
      : true,
  )

  for (const block of filteredLibraries) {
    const foundPou = block.pous.find((pou) => pou.name === pouName)
    if (foundPou) {
      libraryBlock = foundPou
      break
    }
  }

  return libraryBlock
}

const BlockElement = <T extends object>({ isOpen, onClose, selectedNode }: BlockElementProps<T>) => {
  const {
    editor,
    editorActions: { updateModelVariables },
    fbdFlows,
    fbdFlowActions: { setNodes, setEdges },
    project: {
      data: { pous },
    },
    projectActions: { updateVariable, deleteVariable },
    libraries,
    modalActions: { onOpenChange },
  } = useOpenPLCStore()

  const maxInputs = 20

  const inputNameRef = useRef<HTMLInputElement>(null)
  const inputInputsRef = useRef<HTMLInputElement>(null)

  const [node, setNode] = useState<BlockNode<object>>(selectedNode)
  const blockVariant = node.data.variant as BlockVariant

  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<BlockVariant | null>(null)
  const [documentation, setDocumentation] = useState<string | null>(getBlockDocumentation(blockVariant))
  const [formState, setFormState] = useState<{
    name: string
    inputs: string
    executionOrder: string
    executionControl: boolean
  }>({
    name: blockVariant.name === '???' ? '' : blockVariant.name,
    inputs:
      blockVariant?.variables
        .filter((variable) => variable.class === 'input' || (variable.class === 'inOut' && variable.name !== 'EN'))
        .length.toString() || '0',
    executionOrder: selectedNode.data.executionOrder.toString(),
    executionControl: selectedNode.data.executionControl,
  })

  const isFormValid = Object.values(formState).every((value) => value !== '')
  const isBlockDifferent = selectedNode !== node

  useEffect(() => {
    if (!selectedFileKey) return

    const [type, selectedLibrary, selectedPou] = selectedFileKey?.split('/') || []
    if (type === 'system' && selectedLibrary && selectedPou) {
      const library = libraries.system.find((library) => library.name === selectedLibrary)
      const pou = library?.pous.find((pou) => pou.name === selectedPou) as BlockVariant
      setSelectedFile(pou)
      return
    }
    if (type === 'user' && selectedLibrary) {
      const library = libraries.user.find((library) => library.name === selectedLibrary)
      if (library) {
        setSelectedFile(library as BlockVariant)
        return
      }
    }
    setSelectedFile(null)
  }, [selectedFileKey])

  useEffect(() => {
    if (selectedFile && selectedFile !== selectedNode.data.variant) {
      const [type, _selectedLibrary, _selectedPou] = selectedFileKey?.split('/') || []

      let pouLibrary = undefined
      if (type === 'user') {
        const pou = pous.find((pou) => pou.data.name === selectedFile?.name)
        if (!pou) return
        const variables = pou.data.variables.map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        }))
        if (pou.type === 'function') {
          const variable = getVariableRestrictionType(pou.data.returnType)
          variables.push({
            name: 'OUT',
            class: 'output',
            type: {
              definition: (variable.definition as 'array' | 'base-type' | 'user-data-type' | 'derived') ?? 'derived',
              value: pou.data.returnType.toUpperCase(),
            },
          })
        }

        pouLibrary = {
          name: pou.data.name,
          type: pou.type as 'function-block' | 'function',
          variables: variables,
          documentation: pou.data.documentation,
          extensible: false,
        }
      }

      const newNode = buildBlockNode({
        id: node.id,
        position: {
          x: node.position.x,
          y: node.position.y,
        },
        variant: pouLibrary ?? selectedFile,
        executionControl: formState.executionControl,
      })
      setNode({
        ...newNode,
        data: {
          ...newNode.data,
          executionOrder: Number(formState.executionOrder),
          variable: selectedNode.data.variable,
        },
      })

      const newNodeDataVariant = newNode.data.variant as BlockVariant
      const formName: string = newNodeDataVariant.name
      const formInputs: string = newNodeDataVariant.variables
        .filter((variable) => variable.class === 'input' || (variable.class === 'inOut' && variable.name !== 'EN'))
        .length.toString()

      setFormState((prevState) => ({
        ...prevState,
        name: formName,
        inputs: formInputs,
        executionControl: newNode.data.executionControl,
      }))
      setDocumentation(getBlockDocumentation(newNodeDataVariant))
    }
  }, [selectedFile])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    let formValue = value
    if (id === 'name') {
      formValue = value.toUpperCase()
    }
    setFormState((prevState) => ({ ...prevState, [id]: formValue }))
  }

  const handleNameInputSubmit = () => {
    const libraryBlock = searchLibraryByPouName(libraries, editor, pous, formState.name)
    if (libraryBlock) {
      setSelectedFile(libraryBlock as BlockVariant)
    }
  }

  const handleInputsIncrement = () => {
    setFormState((prevState) => ({
      ...prevState,
      inputs: String(Math.min(Number(prevState.inputs) + 1, maxInputs)),
    }))

    const defaultInputType = blockVariant.variables[0].type
    const blockVariables = [
      ...blockVariant.variables,
      {
        name: 'IN' + (Number(formState.inputs) + 1),
        class: 'input',
        type: defaultInputType,
      },
    ].filter((variable) => variable.class === 'input')

    const outputVariable = blockVariant.variables.filter((variable) => variable.class === 'output')
    outputVariable.forEach((variable) => {
      blockVariables.push(variable)
    })

    const { height } = getBlockSize({ ...blockVariant, variables: blockVariables } as BlockVariant, {
      x: (node.data as BasicNodeData).inputConnector?.glbPosition.x || 0,
      y: (node.data as BasicNodeData).inputConnector?.glbPosition.y || 0,
    })

    setNode((node) => ({
      ...node,
      height,
      data: {
        ...node.data,
        variant: {
          ...blockVariant,
          variables: blockVariables,
        },
      },
    }))
  }

  const handleInputsDecrement = () => {
    const newInputsNumber = Math.max(
      Number(formState.inputs) - 1,
      selectedFile?.variables.filter((variable) => variable.class === 'input' || variable.class === 'inOut').length ??
        2,
    )

    setFormState((prevState) => ({
      ...prevState,
      inputs: String(newInputsNumber),
    }))

    const blockVariables = [...blockVariant.variables]
      .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
      .slice(0, newInputsNumber)

    const outputVariable = [...blockVariant.variables].filter(
      (variable) => variable.class === 'output' || variable.class === 'inOut',
    )
    outputVariable.forEach((variable) => {
      blockVariables.push(variable)
    })

    const { height } = getBlockSize(
      { ...blockVariant, variables: blockVariables },
      {
        x: (node.data as BasicNodeData).inputConnector?.glbPosition.x || 0,
        y: (node.data as BasicNodeData).inputConnector?.glbPosition.y || 0,
      },
    )

    setNode((node) => ({
      ...node,
      height,
      data: {
        ...node.data,
        variant: {
          ...blockVariant,
          variables: blockVariables,
        },
      },
    }))
  }

  const handleInputsSubmit = (e: React.FocusEvent<HTMLInputElement>) => {
    const { value: EventValue } = e.target
    const libraryBlock = searchLibraryByPouName(libraries, editor, pous, formState.name)

    const value = Math.max(
      libraryBlock
        ? (libraryBlock as BlockVariant).variables.filter((variable) => variable.class === 'input').length
        : 2,
      Math.min(Number(EventValue), maxInputs),
    )
    setFormState((prevState) => ({ ...prevState, inputs: String(value) }))

    const defaultInputType = blockVariant.variables[0].type
    const blockVariables: BlockVariant['variables'] = []

    if (formState.executionControl) {
      blockVariables.push({
        name: 'EN',
        class: 'input',
        type: { definition: 'base-type', value: 'BOOL' },
      })
    }
    for (let i = 0; i < value; i++) {
      blockVariables.push({
        name: 'IN' + (i + 1),
        class: 'input',
        type: defaultInputType,
      })
    }

    const outputVariable = blockVariant.variables.filter((variable) => variable.class === 'output')
    outputVariable.forEach((variable) => {
      blockVariables.push(variable)
    })

    const { height } = getBlockSize(
      { ...blockVariant, variables: blockVariables },
      {
        x: (node.data as BasicNodeData).inputConnector?.glbPosition.x || 0,
        y: (node.data as BasicNodeData).inputConnector?.glbPosition.y || 0,
      },
    )

    setNode((node) => ({
      ...node,
      height,
      data: {
        ...node.data,
        variant: {
          ...blockVariant,
          variables: blockVariables,
        },
      },
    }))
  }

  const handleExecutionOrderIncrement = () => {
    setFormState((prevState) => ({
      ...prevState,
      executionOrder: String(Math.min(Number(prevState.executionOrder) + 1, maxInputs)),
    }))
  }

  const handleExecutionOrderDecrement = () => {
    setFormState((prevState) => ({
      ...prevState,
      executionOrder: String(Math.max(Number(prevState.executionOrder) - 1, 0)),
    }))
  }

  const handleExecutionControlChange = (checked: boolean) => {
    setFormState((prevState) => ({ ...prevState, executionControl: checked }))

    const newNode = buildBlockNode({
      id: node.id,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      variant: blockVariant,
      executionControl: checked,
    })

    setNode({
      ...newNode,
      data: { ...newNode.data, variable: selectedNode.data.variable },
    })
  }

  const handleClearForm = () => {
    setFormState({ name: '', inputs: '', executionOrder: '0', executionControl: false })
    setSelectedFileKey(null)
    setSelectedFile(null)
  }

  const handleCloseModal = () => {
    handleClearForm()
    if (onClose) onClose()
  }

  const handleBlockSubmit = () => {
    const newNode = buildBlockNode({
      id: `BLOCK_${uuidv4()}`,
      position: {
        x: selectedNode.position.x,
        y: selectedNode.position.y,
      },
      variant: blockVariant,
      executionControl: formState.executionControl,
    })
    newNode.data = {
      ...newNode.data,
      executionOrder: Number(formState.executionOrder),
    }

    const { rung, edges, variables } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: selectedNode.id,
    })
    if (!rung) return

    if (variables.selected && variables.all) {
      if (blockVariant.type === 'function') {
        deleteVariable({
          rowId: variables.all.indexOf(variables.selected),
          scope: 'local',
          associatedPou: editor.meta.name,
        })
        if (
          editor.type === 'plc-graphical' &&
          editor.variable.display === 'table' &&
          parseInt(editor.variable.selectedRow) === variables.all.indexOf(variables.selected)
        ) {
          updateModelVariables({ display: 'table', selectedRow: -1 })
        }
        newNode.data = { ...newNode.data, variable: { name: '' } }
      } else {
        updateVariable({
          data: {
            type: {
              definition: 'derived',
              value: (newNode.data as BlockNodeData<BlockVariant>).variant.name,
            },
          },
          rowId: variables.all.indexOf(variables.selected),
          scope: 'local',
          associatedPou: editor.meta.name,
        })
        newNode.data = { ...newNode.data, variable: variables.selected }
      }
    }

    let newNodes = [...rung.nodes]
    let newEdges = [...rung.edges]

    newNodes = newNodes.map((n) => (n.id === node.id ? newNode : n))

    edges.source?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newNode.id),
        source: newNode.id,
        sourceHandle: newNode.data.outputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })
    edges.target?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newNode.id),
        target: newNode.id,
        targetHandle: newNode.data.inputConnector.id,
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

    handleCloseModal()
  }

  const labelStyle = 'text-sm font-medium text-neutral-950 dark:text-white'
  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('block-fbd-element', open)}>
      {/* <ModalTrigger>Open</ModalTrigger> */}
      <ModalContent
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          handleCloseModal()
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          handleCloseModal()
        }}
        className='h-[739px] w-[625px] select-none flex-col gap-8 px-14 py-4'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Block Properties</ModalTitle>
        <div className='flex h-[587px] w-full justify-between'>
          <div id='container-modifier-variable' className='h-full w-[236px]'>
            <div className='flex h-full w-full flex-col gap-2'>
              <label className={labelStyle}>Type:</label>
              <ModalBlockLibrary selectedFileKey={selectedFileKey} setSelectedFileKey={setSelectedFileKey} />
              <div className='border-neural-100 h-full max-h-[119px] overflow-hidden rounded-lg border px-1 py-4 text-xs font-normal text-neutral-950 dark:border-neutral-850 dark:text-neutral-100'>
                <div className='h-full overflow-y-auto'>
                  <span className='h-full whitespace-pre-line px-1 dark:text-neutral-100'>{documentation}</span>
                </div>
              </div>
            </div>
          </div>
          <div id='preview' className='flex h-full w-[236px] flex-col gap-2'>
            <label htmlFor='name' className={labelStyle}>
              Name:
            </label>
            <InputWithRef
              id='name'
              ref={inputNameRef}
              className={inputStyle}
              placeholder='???'
              type='text'
              value={formState.name}
              onChange={handleInputChange}
              onBlur={handleNameInputSubmit}
              onKeyDown={(e) => e.key === 'Enter' && inputNameRef.current?.blur()}
            />
            {blockVariant.type === 'function' && blockVariant.extensible && (
              <>
                <label htmlFor='inputs' className={labelStyle}>
                  Inputs:
                </label>
                <div className='flex items-center gap-1'>
                  <InputWithRef
                    id='inputs'
                    ref={inputInputsRef}
                    className={inputStyle}
                    placeholder=''
                    type='number'
                    value={formState.inputs}
                    onChange={handleInputChange}
                    onBlur={(e) => handleInputsSubmit(e)}
                    onKeyDown={(e) => e.key === 'Enter' && inputInputsRef.current?.blur()}
                  />
                  <ArrowButtonGroup
                    onIncrement={() => handleInputsIncrement()}
                    onDecrement={() => handleInputsDecrement()}
                  />
                </div>
              </>
            )}
            <label htmlFor='executionOrder' className={labelStyle}>
              Execution Order:
            </label>
            <div className='flex items-center gap-1'>
              <InputWithRef
                id='executionOrder'
                className={inputStyle}
                placeholder=''
                type='number'
                value={formState.executionOrder}
                onChange={handleInputChange}
              />
              <ArrowButtonGroup
                onIncrement={() => handleExecutionOrderIncrement()}
                onDecrement={() => handleExecutionOrderDecrement()}
              />
            </div>

            <div className='flex items-center gap-2'>
              <label htmlFor='executionControlSwitch' className={labelStyle}>
                Execution Control:
              </label>
              <Switch.Root
                className={cn(
                  'relative h-4 w-[29px] cursor-pointer rounded-full bg-neutral-300 shadow-[0_4_4_1px] outline-none transition-all duration-150 data-[state=checked]:bg-brand dark:bg-neutral-850',
                )}
                id='executionControlSwitch'
                onCheckedChange={handleExecutionControlChange}
                checked={formState.executionControl}
              >
                <Switch.Thumb className='block h-[14px] w-[14px] translate-x-0.5 rounded-full bg-white shadow-[0_0_4_1px] transition-all duration-150 will-change-transform data-[state=checked]:translate-x-[14px]' />
              </Switch.Root>
            </div>

            <label htmlFor='block-preview' className={labelStyle}>
              Preview
            </label>
            <div
              id='block-preview'
              className='flex h-[330px] items-center justify-center rounded-lg border-[2px] border-brand-dark bg-transparent dark:border-neutral-850'
            >
              <BlockNodeElement
                nodeId={node.id || ''}
                data={node.data}
                height={node.height || 0}
                width={node.width || 0}
                selected={false}
                disabled={true}
                scale={310 / ((node.height || 310) <= 310 ? 310 : node.height || 310)}
              />
            </div>
          </div>
        </div>
        <div className='flex !h-8 w-full justify-evenly gap-7'>
          <button
            className='h-full w-[236px] items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
            onClick={handleCloseModal}
          >
            Cancel
          </button>
          <button
            className={
              'h-full w-[236px] items-center rounded-lg bg-brand text-center font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'
            }
            disabled={!isFormValid || !isBlockDifferent}
            onClick={handleBlockSubmit}
          >
            Ok
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default BlockElement
