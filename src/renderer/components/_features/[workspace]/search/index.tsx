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
    type: 'plc-function' | 'plc-graphical' | 'plc-datatype' | 'plc-resource'
    pou: {
      name: string
      language: 'ld' | 'sfc' | 'fbd' | 'il' | 'st'
      pouType: 'program' | 'function' | 'function-block'
      variable: string | null
    }
  }[]
}

interface SearchProps {
  items: SearchResult[]
}

const Search = ({ items }: SearchProps) => {
  const { searchActions } = useOpenPLCStore()

  console.log(items.map((item) => item.functions.map((func) => func.pou.variable)))

  const handleRemoveSearchResult = (index: number) => {
    searchActions.removeSearchResult(index)
  }

  return (
    <div className='h-full w-full text-cp-sm'>
      <div className='flex h-full w-full flex-col gap-1 rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-900'>
        <div className='header relative flex flex-col overflow-auto pr-1'>
          {items.map((item, index) => (
            <Accordion
              key={index}
              items={[
                {
                  title: (
                    <div className='flex w-full items-center justify-between'>
                      <span className='text-sm font-medium text-neutral-950 dark:text-white'>{item.searchQuery}</span>
                      <CloseIcon
                        className='ml-2 w-4 cursor-pointer stroke-white hover:stroke-red-500'
                        onClick={() => handleRemoveSearchResult(index)}
                      />
                    </div>
                  ),
                  content: (
                    <ProjectSearchTreeRoot label={item.projectName}>
                      {item.functions.map((func, funcIndex) => (
                        <div key={funcIndex}>
                          <ProjectSearchTreeBranch branchTarget={func.pou.pouType}>
                            {func.pou.variable ? (
                              <ProjectSearchTreeVariableBranch label={func.pou.name} leafLang={func.pou.language}>
                                {func.pou.variable.split(', ').map((variable, variableIndex) => (
                                  <ProjectSearchTreeVariableLeaf key={variableIndex} label={variable} />
                                ))}
                              </ProjectSearchTreeVariableBranch>
                            ) : (
                              <ProjectSearchTreeLeaf label={func.pou.name} leafLang={func.pou.language} />
                            )}
                          </ProjectSearchTreeBranch>
                        </div>
                      ))}
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
