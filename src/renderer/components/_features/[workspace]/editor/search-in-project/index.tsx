import * as Checkbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { InputWithRef } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { useToast } from '../../../[app]/toast/use-toast'

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
  const [sensitiveCaseOption, setSensitiveCaseOption] = useState(false)
  const [regularExpressionOption, setRegularExpressionOption] = useState(false)
  const [disabledSensitiveCaseOption, setDisabledSensitiveCaseOption] = useState(false)
  const [disabledRegularExpressionOption, setDisabledRegularExpressionOption] = useState(false)
  const [typedSearchQuery, setTypedSearchQuery] = useState('')

  const { toast } = useToast()
  const {
    project: { data, meta },
    searchQuery,
    searchActions: { setSearchQuery, setSearchResults, setSensitiveCase, setRegularExpression },
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
    if (!searchQuery.trim()) {
      toast({
        title: 'No search query',
        description: 'Please enter a search query to search.',
        variant: 'warn',
      })
      return
    }

    const filterMap = {
      'data type': 'data-type',
      function: 'function',
      'function block': 'function-block',
      program: 'program',
      configuration: 'configuration',
    }

    const activeFilters = Object.keys(checkedOptions)
      .filter((key) => checkedOptions[key])
      .map((key) => filterMap[key as keyof typeof filterMap])

    const countOccurrences = (
      text: string,
      searchQuery: string,
      sensitiveCase: boolean,
      regularExpressionOption: boolean,
    ): number => {
      if (regularExpressionOption) {
        try {
          const regex = new RegExp(searchQuery, sensitiveCase ? 'g' : 'gi')
          const matches = text.match(regex)
          return matches ? matches.length : 0
        } catch (e) {
          if (e instanceof SyntaxError) {
            toast({
              title: 'Invalid Regular Expression',
              description: 'The regular expression provided is invalid.',
              variant: 'warn',
            })
          }
          return 0
        }
      } else {
        const regex = new RegExp(searchQuery, sensitiveCase ? 'g' : 'gi')
        const matches = text.match(regex)
        return matches ? matches.length : 0
      }
    }

    const groupedPous = data.pous
      .filter((pou) => {
        const pouTypeMatchesFilter = activeFilters.length === 0 || activeFilters.includes(pou.type)

        const pouMatches = regularExpressionOption
          ? countOccurrences(pou.data.name, searchQuery, sensitiveCaseOption, regularExpressionOption) > 0
          : sensitiveCaseOption
            ? pou.data.name.includes(searchQuery)
            : pou.data.name.toLowerCase().includes(searchQuery.toLowerCase())

        const variableMatches = pou.data.variables.some((variable) =>
          regularExpressionOption
            ? countOccurrences(variable.name, searchQuery, sensitiveCaseOption, regularExpressionOption) > 0
            : sensitiveCaseOption
              ? variable.name.includes(searchQuery)
              : variable.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )

        return (
          pouTypeMatchesFilter &&
          (pouMatches ||
            variableMatches ||
            (['st', 'il'].includes(pou.data.language) &&
              (() => {
                try {
                  const regex = new RegExp(searchQuery, sensitiveCaseOption ? 'g' : 'gi')
                  const matches = (pou.data.body.value as string).match(regex)
                  return matches ? matches.length > 0 : false
                } catch (error) {
                  console.error('Invalid regex or error processing body:', error)
                  return false
                }
              })()))
        )
      })
      .reduce(
        (acc, pou) => {
          const pouType = pou.type

          if (!acc[pouType]) {
            acc[pouType] = []
          }

          acc[pouType].push({
            name: pou.data.name,
            language: pou.data.language,
            pouType: pou.type,
            body:
              (['st', 'il'].includes(pou.data.language) &&
                (() => {
                  try {
                    const regex = new RegExp(`\\b(${searchQuery}\\w*)`, sensitiveCaseOption ? 'g' : 'gi')
                    const matches = (pou.data.body.value as string).match(regex)
                    return matches ? matches.join(', ') : ''
                  } catch (error) {
                    console.error('Invalid regex or error processing body:', error)
                    return ''
                  }
                })()) ||
              '',
            variable: pou.data.variables
              .filter((variable) =>
                regularExpressionOption
                  ? countOccurrences(variable.name, searchQuery, sensitiveCaseOption, regularExpressionOption) > 0
                  : sensitiveCaseOption
                    ? variable.name.includes(searchQuery)
                    : variable.name.toLowerCase().includes(searchQuery.toLowerCase()),
              )
              .map((variable) => variable.name)
              .join(', '),
          })

          return acc
        },
        {} as Record<
          string,
          Array<{
            name: string
            language: 'ld' | 'sfc' | 'fbd' | 'il' | 'st' | 'python'
            pouType: 'function' | 'function-block' | 'program'
            body: string
            variable: string
          }>
        >,
      )

    const filteredDataTypes = data.dataTypes
      .filter((dataType) => {
        const dataTypeMatchesFilter = activeFilters.length === 0 || activeFilters.includes('data-type')
        return (
          dataTypeMatchesFilter &&
          (regularExpressionOption
            ? countOccurrences(dataType.name, searchQuery, sensitiveCaseOption, regularExpressionOption) > 0
            : sensitiveCaseOption
              ? dataType.name.includes(searchQuery)
              : dataType.name.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      })
      .map((dataType) => ({
        name: dataType.name,
        type: dataType.derivation,
      }))

    const resourceGlobalVar = data.configuration.resource.globalVariables.filter((variable) => {
      const resourceMatchesFilter = activeFilters.length === 0 || activeFilters.includes('configuration')
      return (
        resourceMatchesFilter &&
        (regularExpressionOption
          ? countOccurrences(variable.name, searchQuery, sensitiveCaseOption, regularExpressionOption) > 0
          : sensitiveCaseOption
            ? variable.name.includes(searchQuery)
            : variable.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    })

    const resourceTasks = data.configuration.resource.tasks.filter((task) => {
      const resourceMatchesFilter = activeFilters.length === 0 || activeFilters.includes('configuration')
      return (
        resourceMatchesFilter &&
        (regularExpressionOption
          ? countOccurrences(task.name, searchQuery, sensitiveCaseOption, regularExpressionOption) > 0
          : sensitiveCaseOption
            ? task.name.includes(searchQuery)
            : task.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    })

    const resourceInstances = data.configuration.resource.instances.filter((instance) => {
      const resourceMatchesFilter = activeFilters.length === 0 || activeFilters.includes('configuration')
      return (
        resourceMatchesFilter &&
        (regularExpressionOption
          ? countOccurrences(instance.name, searchQuery, sensitiveCaseOption, regularExpressionOption) > 0
          : sensitiveCaseOption
            ? instance.name.includes(searchQuery)
            : instance.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    })

    const resource = {
      globalVariable: resourceGlobalVar.map((variable) => variable.name).join(', '),
      task: resourceTasks.map((task) => task.name).join(', '),
      instance: resourceInstances.map((instance) => instance.name).join(', '),
    }

    const totalMatches =
      Object.keys(groupedPous).reduce((acc, pouType) => {
        return (
          acc +
          groupedPous[pouType].reduce((innerAcc, pou) => {
            const nameMatches = countOccurrences(pou.name, searchQuery, sensitiveCaseOption, regularExpressionOption)
            const variableMatches = countOccurrences(
              pou.variable,
              searchQuery,
              sensitiveCaseOption,
              regularExpressionOption,
            )
            const bodyMatches = ['st', 'il'].includes(pou.language)
              ? countOccurrences(pou.body, searchQuery, sensitiveCaseOption, regularExpressionOption)
              : 0
            return innerAcc + nameMatches + variableMatches + bodyMatches
          }, 0)
        )
      }, 0) +
      filteredDataTypes.length +
      resourceGlobalVar.length +
      resourceTasks.length +
      resourceInstances.length

    const formattedResults = {
      searchID: uuidv4(),
      searchQuery,
      projectName: meta.name,
      functions: {
        pous: groupedPous,
        dataTypes: filteredDataTypes,
        resource,
      },
      searchCounts: totalMatches,
    }

    const noResults =
      Object.keys(groupedPous).length === 0 &&
      filteredDataTypes.length === 0 &&
      resourceGlobalVar.length === 0 &&
      resourceTasks.length === 0

    if (noResults) {
      toast({
        title: 'No results found',
        description: 'No matches were found for your search.',
        variant: 'warn',
      })
    } else {
      setSearchResults(formattedResults)
      onClose()
    }
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
            value={typedSearchQuery}
            placeholder='Search'
            onBlur={handleSearchQueryChange}
            onChange={(event) => {
              setTypedSearchQuery(event.target.value)
            }}
          />
        </div>
        <div className='flex flex-col justify-between'>
          <CheckboxOption
            id='case-sensitive'
            label='Case Sensitive'
            checked={sensitiveCaseOption}
            onChange={() => {
              setSensitiveCaseOption(!sensitiveCaseOption)
              setSensitiveCase(!sensitiveCaseOption)
              setDisabledRegularExpressionOption(!disabledRegularExpressionOption)
            }}
            disabled={disabledSensitiveCaseOption}
          />
          <CheckboxOption
            id='regular-expression'
            label='Regular Expression'
            checked={regularExpressionOption}
            onChange={() => {
              setRegularExpressionOption(!regularExpressionOption)
              setRegularExpression(!regularExpressionOption)
              setDisabledSensitiveCaseOption(!disabledSensitiveCaseOption)
            }}
            disabled={disabledRegularExpressionOption}
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
