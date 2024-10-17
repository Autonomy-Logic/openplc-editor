import { CloseIcon } from '@root/renderer/assets'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'
import { Accordion } from '@root/renderer/components/_atoms/accordion'
import { useOpenPLCStore } from '@root/renderer/store'

import { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot } from './display/tree-view'

interface SearchResult {
  searchQuery: string
  projectName: string
  functions: {
    type: 'plc-function' | 'plc-graphical' | 'plc-datatype' | 'plc-resource'
    pou: {
      name: string
      language: 'ld' | 'sfc' | 'fbd' | 'il' | 'st'
      pouType: 'program' | 'function' | 'function-block'
      variable: string
    }
  }[]
}

interface SearchProps {
  items: SearchResult[]
}

const Search = ({ items }: SearchProps) => {
  const { searchActions } = useOpenPLCStore()

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
                    <ProjectTreeRoot label={item.projectName}>
                      {item.functions.map((func, funcIndex) => (
                        <div key={funcIndex}>
                          <ProjectTreeBranch branchTarget={func.pou.pouType}>
                            <div className='flex items-start gap-1'>
                              <ProjectTreeLeaf label={func.pou.name} leafLang={func.pou.language} />
                              {func.pou.variable && (
                                <div className='flex h-7 w-full select-none items-center gap-1 rounded-lg p-1 text-cp-sm'>
                                  <p> - </p>
                                  <ZapIcon className='h-4 w-4' />
                                  <p>{func.pou.variable}</p>
                                </div>
                              )}
                            </div>
                          </ProjectTreeBranch>
                        </div>
                      ))}
                    </ProjectTreeRoot>
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
