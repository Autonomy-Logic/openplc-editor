import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
import type { BasicNodeData, CoilProps } from './utils/types'
import { VariablesBlockAutoComplete } from './variables-block-autocomplete'
import { DEFAULT_COIL_BLOCK_HEIGHT, DEFAULT_COIL_BLOCK_WIDTH, DEFAULT_COIL_TYPES } from './utils/constants'

export const Coil = (block: CoilProps) => {
  const { selected, data, id } = block

  const {
    editor,
    project: {
      data: { pous },
    },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const coil = DEFAULT_COIL_TYPES[data.variant]
  const [coilVariableValue, setCoilVariableValue] = useState<string>(data.variable.name)
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)
  const autocompleteRef = useRef<
    HTMLDivElement & {
      focus: () => void
      isFocused: boolean
      selectedVariable: { positionInArray: number; variableName: string }
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  useEffect(() => {
    if (inputVariableRef.current && inputWrapperRef.current) {
      inputWrapperRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-24px' : '-20px'
    }
  }, [coilVariableValue])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setCoilVariableValue(data.variable.name)
      return
    }

    if (inputVariableRef.current && selected) {
      inputVariableRef.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    const { variables, node, rung } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: coilVariableValue,
    })

    if (!rung || !node) return

    const variable = variables.selected
    if (!variable) {
      setWrongVariable(true)
      return
    }

    if (variable && (variable.type.definition !== 'base-type' || variable.type.value.toUpperCase() !== 'BOOL')) {
      setWrongVariable(true)
      return
    }

    if ((node.data as BasicNodeData).variable.id !== variable.id) {
      setCoilVariableValue(variable.name)
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
      setWrongVariable(false)
      return
    }

    if ((node.data as BasicNodeData).variable.id === variable.id && variable.name !== coilVariableValue) {
      if ((node.data as BasicNodeData).variable.name !== variable.name) {
        updateNode({
          editorName: editor.meta.name,
          rungId: rung.id,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: {
                ...variable,
                name: variable.name,
              },
            },
          },
        })
      }
      setCoilVariableValue(variable.name)
      setWrongVariable(false)
      return
    }

    setWrongVariable(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitCoilVariableOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || coilVariableValue
    const { variables, rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: variableNameToSubmit,
    })
    if (!rung || !node) return

    const variable = variables.selected
    if (
      !variable ||
      variable.name !== variableNameToSubmit ||
      variable.type.definition !== 'base-type' ||
      variable.type.value.toUpperCase() !== 'BOOL'
    ) {
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: { name: variableNameToSubmit },
          },
        },
      })
      setWrongVariable(true)
      return
    }

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: node.id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: variable,
        },
      },
    })
    setWrongVariable(false)
  }

  const onChangeHandler = () => {
    if (!openAutocomplete) {
      setOpenAutocomplete(true)
    }
  }

  return (
    <div
      className={cn({
        'opacity-40': id.startsWith('copycat'),
      })}
    >
      <div
        className={cn(
          'relative rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[3px] hover:outline-brand',
          {
            'outline outline-2 outline-offset-[3px] outline-brand': selected,
          },
        )}
        style={{ width: DEFAULT_COIL_BLOCK_WIDTH, height: DEFAULT_COIL_BLOCK_HEIGHT }}
      >
        {coil.svg(wrongVariable)}
        <div className='absolute left-1/2 w-[72px] -translate-x-1/2' ref={inputWrapperRef}>
          <HighlightedTextArea
            textAreaValue={coilVariableValue}
            setTextAreaValue={setCoilVariableValue}
            handleSubmit={handleSubmitCoilVariableOnTextareaBlur}
            inputHeight={{
              height: 24,
              scrollLimiter: 32,
            }}
            ref={inputVariableRef}
            textAreaClassName='text-center text-xs leading-3'
            highlightClassName='text-center text-xs leading-3'
            onFocus={(e) => {
              e.target.select()
              const { node, rung } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
                nodeId: id ?? '',
              })
              if (!node || !rung) return
              updateNode({
                editorName: editor.meta.name,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: false,
                },
              })
              return
            }}
            onBlur={() => {
              const { node, rung } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
                nodeId: id ?? '',
              })
              if (!node || !rung) return
              updateNode({
                editorName: editor.meta.name,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: node.data.draggable as boolean,
                },
              })
              return
            }}
            onChange={onChangeHandler}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
              if (e.key === 'Enter' && autocompleteRef.current?.selectedVariable.positionInArray !== -1) {
                inputVariableRef.current?.blur({ submit: false })
              }
              setKeyPressedAtTextarea(e.key)
            }}
            onKeyUp={() => setKeyPressedAtTextarea('')}
          />
          {openAutocomplete && (
            <div className='relative flex justify-center'>
              <div className='absolute -bottom-4'>
                <VariablesBlockAutoComplete
                  ref={autocompleteRef}
                  block={block}
                  blockType={'coil'}
                  valueToSearch={coilVariableValue}
                  isOpen={openAutocomplete}
                  setIsOpen={(value) => setOpenAutocomplete(value)}
                  keyPressed={keyPressedAtTextarea}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
  )
}
