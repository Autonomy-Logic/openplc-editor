import { CloseIcon } from '@root/renderer/assets'
import { Accordion } from '@root/renderer/components/_atoms/accordion'
import { useOpenPLCStore } from '@root/renderer/store'

import {
  ProjectSearchTreeBranch,
  ProjectSearchTreeLeaf,
  ProjectSearchTreeRoot,
  ProjectSearchTreeVariableBranch,
  ProjectSearchTreeVariableLeaf,
} from './display/tree-view'

interface SearchResult {
  searchQuery: string
  projectName: string
  functions: {
    pous: Record<
      'program' | 'function' | 'function-block',
      Array<{
        name: string
        language: 'ld' | 'sfc' | 'fbd' | 'il' | 'st'
        pouType: 'program' | 'function' | 'function-block'
        body: string
        variable: string | null
      }>
    >
    dataTypes: {
      name: string
      type: 'array' | 'structure' | 'enumerated'
    }[]
    resource: {
      globalVariable: string
      task: string
    }
  }
  searchCounts?: number
}

interface SearchProps {
  items: SearchResult[]
}

const Search = ({ items }: SearchProps) => {
  const { searchActions } = useOpenPLCStore()

  const handleRemoveSearchResult = (index: number) => {
    searchActions.removeSearchResult(index)
  }

  const mapDataTypeToLeafLang = (type: 'array' | 'structure' | 'enumerated'): 'arr' | 'str' | 'enum' => {
    switch (type) {
      case 'array':
        return 'arr'
      case 'structure':
        return 'str'
      case 'enumerated':
        return 'enum'
      default:
        return 'arr'
    }
  }

  const extractSearchQuery = (body: string, searchQuery: string) => {
    const regex = new RegExp(`(${searchQuery})`, 'gi')
    const match = body.match(regex)
    if (match) {
      return body.replace(regex, (matched) => `<span class='text-brand-medium dark:text-brand-light'>${matched}</span>`)
    }
    return body
  }

  const extractSearchQueryBody = (body: string, searchQuery: string) => {
    const regex = new RegExp(`(${searchQuery})`, 'gi')
    const match = body.match(regex)
    return match ? `<span class='text-brand-medium dark:text-brand-light'>${match[0]}</span>` : body
  }

  return (
    <div className='h-full w-full text-cp-sm'>
      <div className='flex h-full w-full flex-col gap-1 rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-950'>
        <div className='header relative flex flex-col overflow-auto pr-1'>
          {items.map((item, index) => (
            <Accordion
              key={index}
              items={[
                {
                  title: (
                    <div className='flex w-full items-center justify-between'>
                      <p className='text-sm font-medium text-neutral-950 dark:text-white'>
                        {item.searchQuery}
                        <span className='text-cp-sm font-normal text-neutral-950 dark:text-white'>
                          {' '}
                          - {item.searchCounts} matches
                        </span>
                      </p>
                      <CloseIcon
                        className='ml-2 w-4 cursor-pointer stroke-brand hover:stroke-red-500 dark:stroke-white'
                        onClick={() => handleRemoveSearchResult(index)}
                      />
                    </div>
                  ),
                  content: (
                    <ProjectSearchTreeRoot label={item.projectName}>
                      {Object.keys(item.functions.pous).map((pouType) => (
                        <ProjectSearchTreeBranch
                          key={pouType}
                          branchTarget={pouType as 'function' | 'program' | 'function-block'}
                        >
                          {item.functions.pous[pouType as 'function' | 'program' | 'function-block'].map(
                            (pou, pouIndex) =>
                              pou.variable || pou.language === 'st' || pou.language === 'il' ? (
                                <ProjectSearchTreeVariableBranch
                                  key={pouIndex}
                                  label={extractSearchQuery(pou.name, item.searchQuery)}
                                  leafLang={pou.language}
                                >
                                  {pou.variable &&
                                    pou.variable
                                      .split(', ')
                                      .map((variable, variableIndex) => (
                                        <ProjectSearchTreeVariableLeaf
                                          key={variableIndex}
                                          label={extractSearchQuery(variable, item.searchQuery)}
                                          hasVariable
                                        />
                                      ))}
                                  {(pou.language === 'st' || pou.language === 'il') && (
                                    <ProjectSearchTreeVariableLeaf
                                      label={extractSearchQueryBody(pou.body, item.searchQuery)}
                                    />
                                  )}
                                </ProjectSearchTreeVariableBranch>
                              ) : (
                                <ProjectSearchTreeLeaf
                                  key={pouIndex}
                                  label={extractSearchQuery(pou.name, item.searchQuery)}
                                  leafLang={pou.language}
                                />
                              ),
                          )}
                        </ProjectSearchTreeBranch>
                      ))}

                      {item.functions.dataTypes.length > 0 && (
                        <ProjectSearchTreeBranch branchTarget='data-type'>
                          {item.functions.dataTypes.map((dataType, dataTypeIndex) => (
                            <ProjectSearchTreeLeaf
                              key={dataTypeIndex}
                              label={extractSearchQuery(dataType.name, item.searchQuery)}
                              leafLang={mapDataTypeToLeafLang(dataType.type)}
                            />
                          ))}
                        </ProjectSearchTreeBranch>
                      )}

                      {(item.functions.resource.globalVariable || item.functions.resource.task) && (
                        <ProjectSearchTreeBranch branchTarget='resource'>
                          {item.functions.resource.globalVariable && (
                            <ProjectSearchTreeVariableBranch label='Global Variables' leafLang='res'>
                              {item.functions.resource.globalVariable.split(', ').map((variable, variableIndex) => (
                                <ProjectSearchTreeVariableLeaf
                                  key={variableIndex}
                                  label={extractSearchQuery(variable, item.searchQuery)}
                                  hasVariable
                                />
                              ))}
                            </ProjectSearchTreeVariableBranch>
                          )}
                          {item.functions.resource.task && (
                            <ProjectSearchTreeVariableBranch label='Tasks' leafLang='res'>
                              {item.functions.resource.task.split(', ').map((task, taskIndex) => (
                                <ProjectSearchTreeVariableLeaf
                                  key={taskIndex}
                                  label={extractSearchQuery(task, item.searchQuery)}
                                  hasVariable
                                />
                              ))}
                            </ProjectSearchTreeVariableBranch>
                          )}
                        </ProjectSearchTreeBranch>
                      )}
                    </ProjectSearchTreeRoot>
                  ),
                },
              ]}
              type='single'
              defaultValue={item.searchQuery}
              collapsible={true}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export { Search }
