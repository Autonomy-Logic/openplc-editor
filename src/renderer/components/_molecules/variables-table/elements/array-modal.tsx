import { DimensionsModal } from '@root/renderer/components/_atoms/dimensions-modal'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { arrayValidation } from '@root/renderer/store/slices/workspace/utils/variables'
import { BaseType, baseTypeSchema } from '@root/types/PLC/open-plc'
import { useEffect, useState } from 'react'

type ArrayModalProps = {
  variableName: string
  VariableRow?: number
  arrayModalIsOpen: boolean
  setArrayModalIsOpen: (value: boolean) => void
  closeContainer: () => void
}

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
  } = useOpenPLCStore()

  const baseTypes = baseTypeSchema.options
  const allTypes = [
    ...baseTypes,
    ...dataTypes.map((type) => (type.name !== name ? type.name : '')).filter((type) => type !== ''),
  ]

  const [selectedInput, setSelectedInput] = useState<string>('')
  const [dimensions, setDimensions] = useState<string[]>([])
  const [typeValue, setTypeValue] = useState<string>('dint')

  useEffect(() => {
    const variable = pous
      .find((pou) => pou.data.name === name)
      ?.data.variables.find((variable) => variable.name === variableName)
    if (!variable) return

    if (variable.type.definition === 'array') {
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
      const [removed] = dimensions.splice(index, 1)
      dimensions.splice(index - 1, 0, removed)
      setSelectedInput((index - 1).toString())
      return
    }

    if (index === dimensions.length - 1) return
    const [removed] = dimensions.splice(index, 1)
    dimensions.splice(index + 1, 0, removed)
    setSelectedInput((index + 1).toString())
  }

  const handleUpdateType = (value: BaseType) => {
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
    const formatArrayName = `ARRAY [${dimensionToSave.join(', ')}] OF ${typeValue?.toUpperCase()}`

    let isBaseType = false
    baseTypes.forEach((type) => {
      if (type === typeValue) isBaseType = true
    })

    updateVariable({
      scope: 'local',
      associatedPou: name,
      rowId: VariableRow,
      data: {
        type: {
          definition: 'array',
          value: formatArrayName,
          data: {
            // @ts-expect-error - This is a valid operation. This is being fixed.
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
      allTypes={allTypes}
      onTypeChange={handleUpdateType}
      dimensions={dimensions}
      selectedInput={selectedInput}
      onAddDimension={handleAddDimension}
      onRemoveDimension={handleRemoveDimension}
      onRearrangeDimensions={handleRearrangeDimensions}
      onInputClick={handleInputClick}
      onUpdateDimension={handleUpdateDimension}
    />
  )
}
