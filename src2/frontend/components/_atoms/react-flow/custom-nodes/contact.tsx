import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
import type { BasicNodeData, ContactProps } from './utils/types'
import { VariablesBlockAutoComplete } from './variables-block-autocomplete'
import { DEFAULT_CONTACT_TYPES, DEFAULT_CONTACT_BLOCK_WIDTH, DEFAULT_CONTACT_BLOCK_HEIGHT } from './utils/constants'

export const Contact = (block: ContactProps) => {
  const { selected, data, id } = block
  const {
    editor,
    project: {
      data: { pous },
    },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const contact = DEFAULT_CONTACT_TYPES[data.variant]
  const [contactVariableValue, setContactVariableValue] = useState<string>(data.variable.name)
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
      // top
      inputWrapperRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-24px' : '-20px'
    }
  }, [contactVariableValue])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setContactVariableValue(data.variable.name)
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
      variableName: contactVariableValue,
    })
    if (!node || !rung) return

    const variable = variables.selected

    if (!variable) {
      setWrongVariable(true)
      return
    }
    if (variable && (variable.type.definition !== 'base-type' || variable.type.value.toUpperCase() !== 'BOOL')) {
      setWrongVariable(true)
      return
    }

    // Variable of the node is different from the selected variable
    if ((node.data as BasicNodeData).variable.id !== variable.id) {
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

    if ((node.data as BasicNodeData).variable.id === variable.id && variable.name !== contactVariableValue) {
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
      setContactVariableValue(variable.name)
      setWrongVariable(false)
      return
    }

    setWrongVariable(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitContactVariableOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || contactVariableValue
    const { rung, node, variables } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
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
          variable,
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
        style={{ width: DEFAULT_CONTACT_BLOCK_WIDTH, height: DEFAULT_CONTACT_BLOCK_HEIGHT }}
      >
        {contact.svg(wrongVariable)}
        <div className='absolute left-1/2 w-[72px] -translate-x-1/2' ref={inputWrapperRef}>
          <HighlightedTextArea
            textAreaValue={contactVariableValue}
            setTextAreaValue={setContactVariableValue}
            handleSubmit={handleSubmitContactVariableOnTextareaBlur}
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
                  blockType={'contact'}
                  valueToSearch={contactVariableValue}
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
