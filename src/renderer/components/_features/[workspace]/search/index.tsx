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
    pous: {
      name: string
      language: 'ld' | 'sfc' | 'fbd' | 'il' | 'st'
      pouType: 'program' | 'function' | 'function-block'
      variable: string | null
    }[]
    dataTypes: {
      name: string
      type: 'array' | 'structure' | 'enumerated'
    }[]
  }
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
                      {item.functions.pous.map((pou, pouIndex) => (
                        <ProjectSearchTreeBranch key={pouIndex} branchTarget={pou.pouType}>
                          {pou.variable ? (
                            <ProjectSearchTreeVariableBranch label={pou.name} leafLang={pou.language}>
                              {pou.variable.split(', ').map((variable, variableIndex) => (
                                <ProjectSearchTreeVariableLeaf key={variableIndex} label={variable} />
                              ))}
                            </ProjectSearchTreeVariableBranch>
                          ) : (
                            <ProjectSearchTreeLeaf label={pou.name} leafLang={pou.language} />
                          )}
                        </ProjectSearchTreeBranch>
                      ))}
                      {item.functions.dataTypes.length > 0 && (
                        <ProjectSearchTreeBranch branchTarget='data-type'>
                          {item.functions.dataTypes.map((dataType, dataTypeIndex) => (
                            <ProjectSearchTreeLeaf
                              key={dataTypeIndex}
                              label={dataType.name}
                              leafLang={mapDataTypeToLeafLang(dataType.type)}
                            />
                          ))}
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
