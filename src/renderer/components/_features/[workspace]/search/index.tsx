import { CloseIcon } from '@root/renderer/assets'
import { Accordion } from '@root/renderer/components/_atoms/accordion'
import { useOpenPLCStore } from '@root/renderer/store'
import { TabsProps } from '@root/renderer/store/slices'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import { CreateEditorObjectFromTab } from '@root/renderer/store/slices/tabs/utils'

import {
  ProjectSearchTreeBranch,
  ProjectSearchTreeLeaf,
  ProjectSearchTreeRoot,
  ProjectSearchTreeVariableBranch,
  ProjectSearchTreeVariableLeaf,
} from './display/tree-view'

interface SearchResult {
  searchID: string
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
      instance: string
    }
  }
  searchCounts?: number
}

interface SearchProps {
  items: SearchResult[]
}

const Search = ({ items }: SearchProps) => {
  const {
    searchActions: { removeSearchResult, setSearchQuery },
    tabsActions: { updateTabs },
    editorActions: { setEditor, addModel, getEditorFromEditors },
  } = useOpenPLCStore()

  const handleCreateTab = ({ elementType, name, path }: TabsProps) => {
    const tabToBeCreated = { name, path, elementType }
    updateTabs(tabToBeCreated)

    const editor = getEditorFromEditors(tabToBeCreated.name)
    if (!editor) {
      const model = CreateEditorObjectFromTab(tabToBeCreated)
      addModel(model)
      setEditor(model)
      return
    }
    addModel(editor)
    setEditor(editor)
  }

  const handleRemoveSearchResult = (itemID: string) => {
    removeSearchResult(itemID)
    setSearchQuery('')
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
      <div className='flex h-full w-full flex-col gap-1 rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-950'>
        <div className='header relative flex flex-col overflow-auto pr-1'>
          {items.length > 0 && (
            <Accordion
              items={items.map((item) => ({
                searchID: item.searchID,
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
                      onClick={() => handleRemoveSearchResult(item.searchID)}
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
                                onClick={() => {
                                  handleCreateTab({
                                    name: pou.name,
                                    path: `/data/pous/${pou.pouType}/${pou.name}`,
                                    elementType: { type: pou.pouType, language: pou.language },
                                  })
                                }}
                              >
                                {pou.variable &&
                                  pou.variable
                                    .split(', ')
                                    .map((variable, variableIndex) => (
                                      <ProjectSearchTreeVariableLeaf
                                        key={variableIndex}
                                        label={extractSearchQuery(variable, item.searchQuery)}
                                        hasVariable
                                        onClick={() => setSearchQuery(variable)}
                                      />
                                    ))}
                                {(pou.language === 'st' || pou.language === 'il') &&
                                  pou.body
                                    .split(', ')
                                    .map((line, lineIndex) => (
                                      <ProjectSearchTreeVariableLeaf
                                        key={lineIndex}
                                        label={extractSearchQuery(line, item.searchQuery)}
                                        hasComment
                                        onClick={() => setSearchQuery(line)}
                                      />
                                    ))}
                              </ProjectSearchTreeVariableBranch>
                            ) : (
                              <ProjectSearchTreeLeaf
                                key={pouIndex}
                                label={extractSearchQuery(pou.name, item.searchQuery)}
                                leafLang={pou.language}
                                onClick={() => {
                                  handleCreateTab({
                                    name: pou.name,
                                    path: `/data/pous/${pou.pouType}/${pou.name}`,
                                    elementType: { type: pou.pouType, language: pou.language },
                                  })
                                  setSearchQuery(item.searchQuery)
                                }}
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
                            onClick={() => {
                              handleCreateTab({
                                name: dataType.name,
                                path: `/data/data-types/${dataType.type}/${dataType.name}`,
                                elementType: { type: 'data-type', derivation: dataType.type },
                              })
                              setSearchQuery(item.searchQuery)
                            }}
                          />
                        ))}
                      </ProjectSearchTreeBranch>
                    )}

                    {(item.functions.resource.globalVariable ||
                      item.functions.resource.task ||
                      item.functions.resource.instance) && (
                      <ProjectSearchTreeBranch branchTarget='resource'>
                        {item.functions.resource.globalVariable && (
                          <ProjectSearchTreeVariableBranch label='Global Variables' leafLang='res'>
                            {item.functions.resource.globalVariable.split(', ').map((variable, variableIndex) => (
                              <ProjectSearchTreeVariableLeaf
                                key={variableIndex}
                                label={extractSearchQuery(variable, item.searchQuery)}
                                hasVariable
                                onClick={() => {
                                  handleCreateTab({
                                    name: 'resource',
                                    path: `/data/configuration/resource`,
                                    elementType: { type: 'resource' },
                                  })
                                  setSearchQuery(item.searchQuery)
                                }}
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
                                onClick={() => {
                                  handleCreateTab({
                                    name: 'resource',
                                    path: `/data/configuration/resource`,
                                    elementType: { type: 'resource' },
                                  })
                                  setSearchQuery(item.searchQuery)
                                }}
                              />
                            ))}
                          </ProjectSearchTreeVariableBranch>
                        )}
                        {item.functions.resource.instance && (
                          <ProjectSearchTreeVariableBranch label='Instances' leafLang='res'>
                            {item.functions.resource.instance.split(', ').map((instance, instanceIndex) => (
                              <ProjectSearchTreeVariableLeaf
                                key={instanceIndex}
                                label={extractSearchQuery(instance, item.searchQuery)}
                                hasVariable
                                onClick={() => {
                                  handleCreateTab({
                                    name: 'resource',
                                    path: `/data/configuration/resource`,
                                    elementType: { type: 'resource' },
                                  })
                                  setSearchQuery(item.searchQuery)
                                }}
                              />
                            ))}
                          </ProjectSearchTreeVariableBranch>
                        )}
                      </ProjectSearchTreeBranch>
                    )}
                  </ProjectSearchTreeRoot>
                ),
              }))}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export { Search }
