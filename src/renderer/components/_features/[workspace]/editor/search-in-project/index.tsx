import * as Checkbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { InputWithRef } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

type OptionProps = {
  id: string
  label: string
}

interface SearchInProjectModalProps {
  onClose: () => void
}

const scopeElements = [{ value: 'whole project' }, { value: 'only elements' }]

const scopeElementsOptions = [
  { value: 'data type' },
  { value: 'function' },
  { value: 'function block' },
  { value: 'program' },
  { value: 'configuration' },
]

const CheckboxOption = ({
  id,
  label,
  disabled = false,
  checked = false,
  onChange,
}: OptionProps & { disabled?: boolean; checked?: boolean; onChange?: () => void }) => (
  <div className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
    <Checkbox.Root
      className={`flex ${disabled ? 'cursor-not-allowed' : ''} h-4 w-4 appearance-none items-center justify-center rounded-[4px] border ${checked ? 'border-brand' : 'border-neutral-300 dark:border-neutral-850'} bg-white outline-none`}
      id={id}
      disabled={disabled}
      checked={checked}
      onCheckedChange={onChange}
    >
      <Checkbox.Indicator className={`${disabled ? 'cursor-not-allowed' : ''}`}>
        <CheckIcon className='stroke-brand' />
      </Checkbox.Indicator>
    </Checkbox.Root>
    <label
      htmlFor={id}
      className={`whitespace-nowrap text-sm font-medium capitalize text-neutral-950 dark:text-white ${disabled ? 'cursor-not-allowed' : 'cursor-pointer '}`}
    >
      {label}
    </label>
  </div>
)

const RadioOption = ({
  id,
  label,
  name,
  checked,
  onChange,
}: OptionProps & { name: string; checked: boolean; onChange: () => void }) => (
  <div className='flex items-center gap-2'>
    <input
      type='radio'
      id={id}
      name={name}
      className='border-1 h-4 w-4 cursor-pointer appearance-none rounded-full border border-[#D1D5DB] ring-0 checked:border-[5px] checked:border-brand dark:border-neutral-850 dark:bg-neutral-300'
      onChange={onChange}
      checked={checked}
    />
    <label htmlFor={id} className='cursor-pointer text-sm font-medium capitalize text-neutral-950 dark:text-white'>
      {label}
    </label>
  </div>
)

export default function SearchInProject({ onClose }: SearchInProjectModalProps) {
  const [selectedScope, setSelectedScope] = useState('whole project')
  const [checkedOptions, setCheckedOptions] = useState<{ [key: string]: boolean }>({})
  const [sensitiveCase, setSensitiveCase] = useState(false)
  const [regularExpression, setRegularExpression] = useState(false)
  const [disabledSensitiveCase, setDisabledSensitiveCase] = useState(false)
  const [disabledRegularExpression, setDisabledRegularExpression] = useState(false)

  const {
    workspace: { projectData },
    searchQuery,
    searchActions: { setSearchQuery, setSearchResults },
  } = useOpenPLCStore()

  useEffect(() => {
    if (selectedScope === 'whole project') {
      const newCheckedOptions = scopeElementsOptions.reduce(
        (acc, option) => {
          acc[option.value] = false
          return acc
        },
        {} as { [key: string]: boolean },
      )
      setCheckedOptions(newCheckedOptions)
    } else {
      const newCheckedOptions = scopeElementsOptions.reduce(
        (acc, option) => {
          acc[option.value] = false
          return acc
        },
        {} as { [key: string]: boolean },
      )
      setCheckedOptions(newCheckedOptions)
    }
  }, [selectedScope])

  useEffect(() => {
    if (selectedScope === 'only elements') {
      const allSelected = scopeElementsOptions.every((option) => checkedOptions[option.value])
      if (allSelected) {
        setSelectedScope('whole project')
      }
    }
  }, [checkedOptions])

  const handleCheckboxChange = (option: string) => {
    setCheckedOptions((prev) => {
      const newCheckedOptions = { ...prev, [option]: !prev[option] }
      return newCheckedOptions
    })
  }

  const handleScopeChange = (scope: string) => {
    if (scope === 'whole project') {
      const newCheckedOptions = scopeElementsOptions.reduce(
        (acc, option) => {
          acc[option.value] = false
          return acc
        },
        {} as { [key: string]: boolean },
      )
      setCheckedOptions(newCheckedOptions)
    } else {
      const newCheckedOptions = scopeElementsOptions.reduce(
        (acc, option) => {
          acc[option.value] = false
          return acc
        },
        {} as { [key: string]: boolean },
      )
      setCheckedOptions(newCheckedOptions)
    }
    setSelectedScope(scope)
  }

  const handleSearch = () => {
    const pous = projectData.pous
      .filter((pou) => {
        const pouMatches = pou.data.name.toLowerCase().includes(searchQuery.toLowerCase())
        const variableMatches = pou.data.variables.some((variable) =>
          variable.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )

        return pouMatches || variableMatches
      })
      .map((pou) => ({
        name: pou.data.name,
        language: pou.data.language,
        pouType: pou.type,
        variable: pou.data.variables
          .filter((variable) => variable.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((variable) => variable.name)
          .join(', '),
      }))

    const dataTypes = projectData.dataTypes
      .filter((dataType) => dataType.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .map((dataType) => ({
        name: dataType.name,
        type: dataType.derivation.type,
      }))

    const formattedResults = {
      searchQuery,
      projectName: projectData.projectName,
      functions: {
        pous,
        dataTypes,
      },
    }

    setSearchResults(formattedResults)
    console.log(formattedResults)
    setSearchQuery('')
    onClose()
  }

  const handleSearchQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value)
  }

  const handleClose = () => {
    onClose()
  }

  return (
    <div className='flex h-full w-full flex-col gap-8'>
      <div className='flex h-[57px] w-full gap-6'>
        <div className='flex w-full flex-col justify-between'>
          <p className='text-base font-medium text-neutral-950 dark:text-white'>Pattern to Search</p>
          <InputWithRef
            className='h-[30px] w-full rounded-lg border border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-100'
            value={searchQuery}
            onChange={handleSearchQueryChange}
          />
        </div>
        <div className='flex flex-col justify-between'>
          <CheckboxOption
            id='case-sensitive'
            label='Case Sensitive'
            checked={sensitiveCase}
            onChange={() => {
              setSensitiveCase(!sensitiveCase)
              setDisabledRegularExpression(!disabledRegularExpression)
            }}
            disabled={disabledSensitiveCase}
          />
          <CheckboxOption
            id='regular-expression'
            label='Regular Expression'
            checked={regularExpression}
            onChange={() => {
              setRegularExpression(!regularExpression)
              setDisabledSensitiveCase(!disabledSensitiveCase)
            }}
            disabled={disabledRegularExpression}
          />
        </div>
      </div>
      <div className='h-[183px] w-full px-2 py-4'>
        <div className='flex h-full w-full gap-4'>
          <div className='flex flex-col gap-4'>
            <span className='text-base font-medium text-neutral-950 dark:text-white'>Scope:</span>
            {scopeElements.map((element) => (
              <RadioOption
                key={element.value}
                id={element.value}
                name='scope'
                label={element.value}
                checked={selectedScope === element.value}
                onChange={() => handleScopeChange(element.value)}
              />
            ))}
          </div>
          <div
            className={`flex h-[153px] flex-1 items-center rounded-md border-2 border-brand-dark p-2 dark:border-neutral-850 ${selectedScope === 'whole project' ? 'opacity-50' : ''}`}
          >
            <div className='flex w-full flex-col gap-[7px]'>
              {scopeElementsOptions.map((element) => (
                <CheckboxOption
                  key={element.value}
                  id={element.value}
                  label={element.value}
                  disabled={selectedScope === 'whole project'}
                  checked={checkedOptions[element.value]}
                  onChange={() => handleCheckboxChange(element.value)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className='flex !h-8 w-full gap-6'>
        <button
          className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
          onClick={handleClose}
        >
          Close
        </button>
        <button
          className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'
          onClick={handleSearch}
        >
          Find
        </button>
      </div>
    </div>
  )
}
