import { useEffect, useState } from 'react'

import { baseTypeEnum } from '../../../../../middleware/shared/ports/plc-schemas'
import { useOpenPLCStore } from '../../../../store'
import { arrayValidation } from '../../../../store/slices/project/validation/variables'
import { hasStringName } from '../../../../utils/safe-upper'
import { DimensionsModal } from '../../../_atoms/dimensions-modal'
import { toast } from '../../../_features/[app]/toast/use-toast'

type ArrayModalProps = {
  variableName: string
  VariableRow?: number
  arrayModalIsOpen: boolean
  setArrayModalIsOpen: (value: boolean) => void
  closeContainer: () => void
}

type Pou = { type: string; name: string }
type UserLibWithPous = { pous: Pou[] }
type UserLibFunctionBlock = { type: string; name: string }

/**
 * Which shape of user library this is.
 *
 * A predicate rather than an inline `'pous' in userLib && …`: the two members
 * of the union share no discriminant, so the inline form leaves the else
 * branch un-narrowed and every access on it reads as unsafe. Written this way
 * both branches are typed without an assertion.
 */
const hasPous = (lib: UserLibWithPous | UserLibFunctionBlock): lib is UserLibWithPous =>
  'pous' in lib && Array.isArray(lib.pous)

export const ArrayModal = ({
  arrayModalIsOpen,
  closeContainer,
  setArrayModalIsOpen,
  variableName,
  VariableRow,
}: ArrayModalProps) => {
  const {
    editor: {
      meta: { name },
    },
    project: {
      data: { dataTypes, pous },
    },
    projectActions: { updateVariable },
    libraries: sliceLibraries,
  } = useOpenPLCStore()

  // An array element may be any type a plain variable may be, in every
  // language. Python and C++ blocks were once cut down to base types minus
  // TIME/DATE/TOD/DT here, mirroring the same cut in `selectable-cell.tsx`;
  // both bridges now carry the time and calendar types, user-defined types and
  // function block instances, so the element picker offers the full set.
  const baseTypes = baseTypeEnum.options.filter((type) => {
    if (typeof type !== 'string') return false
    if (type.toUpperCase() === 'ARRAY') return false
    return true
  })

  const userDataTypes = dataTypes
    .filter(hasStringName)
    .map((type) => type.name)
    .filter((typeName) => typeName !== name && typeName.toUpperCase() !== 'ARRAY')

  const systemFunctionBlocks = sliceLibraries.system.flatMap((lib) =>
    (lib.pous ?? [])
      .filter((pou) => pou?.type === 'function-block')
      .filter(hasStringName)
      .map((pou) => pou.name.toUpperCase()),
  )

  const userFunctionBlocks = sliceLibraries.user.flatMap((userLib: UserLibWithPous | UserLibFunctionBlock) => {
    if (hasPous(userLib)) {
      return userLib.pous
        .filter((pou) => pou?.type === 'function-block')
        .filter(hasStringName)
        .map((pou) => pou.name.toUpperCase())
    }
    return userLib.type === 'function-block' && typeof userLib.name === 'string' ? [userLib.name.toUpperCase()] : []
  })

  const VariableTypes = [
    { definition: 'base-type', values: baseTypes },
    { definition: 'user-data-type', values: userDataTypes },
  ]

  const LibraryTypes = [
    { definition: 'system', values: systemFunctionBlocks },
    { definition: 'user', values: userFunctionBlocks },
  ]

  const [selectedInput, setSelectedInput] = useState<string>('')
  const [dimensions, setDimensions] = useState<string[]>([])
  const [typeValue, setTypeValue] = useState<string>('dint')

  useEffect(() => {
    const variable = pous
      .find((pou) => pou.name === name)
      ?.interface?.variables?.find((variable) => variable.name === variableName)
    if (!variable) return

    if (variable.type.definition === 'array' && variable.type.data) {
      setDimensions(variable.type.data.dimensions.map((dimension) => dimension.dimension))
      setTypeValue(variable.type.data.baseType.value)
    } else {
      setDimensions([])
      setTypeValue('dint')
    }
  }, [name, variableName, pous])

  const handleAddDimension = () => {
    setDimensions((prev) => [...prev, ''])
    setSelectedInput(dimensions.length.toString())
  }

  const handleRemoveDimension = (index: string) => {
    setDimensions((prev) => [...prev.slice(0, Number(index)), ...prev.slice(Number(index) + 1)])
    setSelectedInput('')
  }

  const handleRearrangeDimensions = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up') {
      if (index === 0) return
      const newDimensions = [...dimensions]
      const [removed] = newDimensions.splice(index, 1)
      newDimensions.splice(index - 1, 0, removed)
      setDimensions(newDimensions)
      setSelectedInput((index - 1).toString())
      return
    }

    if (index === dimensions.length - 1) return
    const newDimensions = [...dimensions]
    const [removed] = newDimensions.splice(index, 1)
    newDimensions.splice(index + 1, 0, removed)
    setDimensions(newDimensions)
    setSelectedInput((index + 1).toString())
  }

  const handleUpdateType = (value: string) => {
    setTypeValue(value)
  }

  const handleUpdateDimension = (index: number, value: string): { ok: boolean } => {
    const res = arrayValidation({ value: value })
    if (!res.ok) {
      toast({
        title: res.title,
        description: res.message,
        variant: 'fail',
      })
      return { ok: false }
    }
    setDimensions((prev) => [...prev.slice(0, index), value, ...prev.slice(index + 1)])
    return { ok: true }
  }

  const handleInputClick = (value: string) => {
    setSelectedInput(value)
  }

  const handleSave = () => {
    const dimensionToSave = dimensions.filter((value) => value !== '')
    if (dimensionToSave.length === 0) {
      toast({
        title: 'Invalid array',
        description: 'Array must have at least one not empty dimension',
        variant: 'fail',
      })
      return
    }
    const formatArrayName = `ARRAY [${dimensionToSave.join(', ')}] OF ${typeValue.toUpperCase()}`

    const isBaseType = (baseTypes as readonly string[]).includes(typeValue)

    updateVariable({
      scope: 'local',
      associatedPou: name,
      rowId: VariableRow,
      data: {
        type: {
          definition: 'array',
          value: formatArrayName,
          data: {
            baseType: {
              definition: isBaseType ? 'base-type' : 'user-data-type',
              value: typeValue,
            },
            dimensions: dimensionToSave.map((dimension) => ({ dimension: dimension })),
          },
        },
      },
    })
    setArrayModalIsOpen(false)
    closeContainer()
  }

  const handleCancel = () => {
    setArrayModalIsOpen(false)
    closeContainer()
  }

  return (
    <DimensionsModal
      open={arrayModalIsOpen}
      onOpenChange={setArrayModalIsOpen}
      onCancel={handleCancel}
      onSave={handleSave}
      typeValue={typeValue}
      onTypeChange={handleUpdateType}
      dimensions={dimensions}
      selectedInput={selectedInput}
      onAddDimension={handleAddDimension}
      onRemoveDimension={handleRemoveDimension}
      onRearrangeDimensions={handleRearrangeDimensions}
      onInputClick={handleInputClick}
      onUpdateDimension={handleUpdateDimension}
      variableTypes={VariableTypes}
      libraryTypes={LibraryTypes}
      hideTrigger
    />
  )
}
