import { useEffect, useMemo, useState } from 'react'

import { baseTypeEnum } from '../../../../middleware/shared/ports/plc-schemas'
import type { VariableClass } from '../../../../middleware/shared/ports/types'
import type { CreateGraphicalVariableModalData } from '../../../store/slices/modal/types'
import { cn } from '../../../utils/cn'
import { isLengthQualifiedType, MAX_STRING_LENGTH, parseStringLength } from '../../../utils/iec-types-registry'
import { getVariableRestrictionType } from '../../../utils/PLC/validate-variable-type'
import { Label } from '../../_atoms/label'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

/** Classes worth offering for a variable created from a graphical box. */
const VARIABLE_CLASSES: VariableClass[] = ['local', 'input', 'output', 'inOut', 'temp']

const inputClass =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'

/**
 * Type dialog for "Add variable" on a generic block pin (issue #479).
 *
 * Deliberately store-free: the state it needs (project data types) and the
 * closing behaviour arrive as props, so the same file is exercisable under the
 * editor's jest and the web's vitest without mocking the store.
 */
type CreateGraphicalVariableModalProps = {
  isOpen: boolean
  data: CreateGraphicalVariableModalData
  /** Project data-type names, offered when the pin is a bare `ANY`. */
  dataTypeNames: string[]
  onOpenChange: (open: boolean) => void
  onClose: () => void
}

const CreateGraphicalVariableModal = ({
  isOpen,
  data,
  dataTypeNames,
  onOpenChange,
  onClose,
}: CreateGraphicalVariableModalProps) => {
  const [name, setName] = useState(data.name)
  const [variableClass, setVariableClass] = useState<VariableClass>('local')
  const [typeValue, setTypeValue] = useState(data.suggestedType.value)
  // Empty means the unqualified type.
  const [stringLength, setStringLength] = useState('')

  // A reused instance must never carry the previous pin's answers over.
  useEffect(() => {
    if (!isOpen) return
    setName(data.name)
    setVariableClass('local')
    setTypeValue(data.suggestedType.value)
  }, [isOpen, data.name, data.suggestedType.value])

  /**
   * Types the pin accepts. A restricted generic (`ANY_NUM`, `ANY_BIT`, …)
   * flattens to its base-type set; a bare `ANY` accepts anything, so it gets
   * every base type plus the project's own data types.
   */
  const typeOptions = useMemo(() => {
    const restriction = getVariableRestrictionType(data.pinType)
    if (Array.isArray(restriction.values)) {
      return restriction.values.map((value) => ({ value, definition: 'base-type' as const }))
    }
    return [
      ...baseTypeEnum.options.map((value) => ({ value, definition: 'base-type' as const })),
      ...dataTypeNames
        .filter((dataTypeName) => dataTypeName.length > 0)
        .map((dataTypeName) => ({ value: dataTypeName, definition: 'user-data-type' as const })),
    ]
  }, [data.pinType, dataTypeNames])

  const handleCancel = () => {
    data.onCancel?.()
    onClose()
  }

  const lengthIsOffered = isLengthQualifiedType(typeValue)
  const declaredType = lengthIsOffered && stringLength.trim() !== '' ? `${typeValue}(${stringLength.trim()})` : typeValue
  const lengthIsValid = !lengthIsOffered || stringLength.trim() === '' || parseStringLength(declaredType).valid

  const handleConfirm = () => {
    const trimmedName = name.trim()
    if (!trimmedName || !lengthIsValid) return
    const selected = typeOptions.find((option) => option.value === typeValue)
    data.onConfirm({
      name: trimmedName,
      class: variableClass,
      // An option the list doesn't know can only come from the suggestion, so
      // keep the definition the editor derived for it.
      type: selected ? { definition: selected.definition, value: declaredType } : data.suggestedType,
    })
    onClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={onOpenChange}>
      <ModalContent
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          handleCancel()
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          handleCancel()
        }}
        className='w-[420px] select-none flex-col gap-4 px-8 py-6'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>New variable</ModalTitle>
        <p className='text-xs text-neutral-700 dark:text-neutral-400'>
          The <span className='font-medium'>{data.pinType.toUpperCase()}</span> pin accepts more than one data type, so
          the editor cannot pick one for you. Confirm the variable before it is created.
        </p>

        <div className='flex flex-col gap-4'>
          <div>
            <Label htmlFor='new-graphical-variable-name' className='mb-2 block text-sm'>
              Name
            </Label>
            <input
              id='new-graphical-variable-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleConfirm()}
              className={inputClass}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor='new-graphical-variable-class' className='mb-2 block text-sm'>
              Class
            </Label>
            <select
              id='new-graphical-variable-class'
              value={variableClass}
              onChange={(event) => setVariableClass(event.target.value as VariableClass)}
              className={inputClass}
            >
              {VARIABLE_CLASSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor='new-graphical-variable-type' className='mb-2 block text-sm'>
              Type
            </Label>
            <select
              id='new-graphical-variable-type'
              value={typeValue}
              onChange={(event) => setTypeValue(event.target.value)}
              className={inputClass}
            >
              {typeOptions.map((option) => (
                <option key={`${option.definition}:${option.value}`} value={option.value}>
                  {option.value}
                </option>
              ))}
            </select>
          </div>

          {lengthIsOffered && (
            <div>
              <Label htmlFor='new-graphical-variable-string-length' className='mb-2 block text-sm'>
                Length
              </Label>
              <input
                id='new-graphical-variable-string-length'
                type='text'
                inputMode='numeric'
                placeholder={`1 to ${MAX_STRING_LENGTH} — empty for plain ${typeValue.toUpperCase()}`}
                value={stringLength}
                onChange={(event) => setStringLength(event.target.value)}
                className={cn(inputClass, !lengthIsValid && 'border-red-500 text-red-500')}
              />
            </div>
          )}
        </div>

        <div className='flex !h-8 w-full gap-6'>
          <button
            className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 hover:bg-neutral-300 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white enabled:hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
            disabled={!name.trim()}
            onClick={handleConfirm}
          >
            Create
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { CreateGraphicalVariableModal }
