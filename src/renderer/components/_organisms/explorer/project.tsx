import {
  ProjectTreeBranch,
  ProjectTreeLeaf,
  ProjectTreeNestedBranch,
  ProjectTreeRoot,
} from '@components/_molecules/project-tree'
import { FolderIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { TabsProps } from '@root/renderer/store/slices'
import { CreateEditorObject } from '@root/renderer/store/slices/shared/utils'

import { CreatePLCElement } from '../../_features/[workspace]/create-element'

const Project = () => {
  const {
    workspace: {
      projectData: { pous, dataTypes },
    },
    tabsActions: { updateTabs },
    editorActions: { setEditor },
  } = useOpenPLCStore()
  const Name = 'Project Name'

  const editorType = {
    il: 'plc-textual',
    st: 'plc-textual',
    ld: 'plc-graphical',
    sfc: 'plc-graphical',
    fbd: 'plc-graphical',
    array: 'plc-datatype',
    enumerated: 'plc-datatype',
    structure: 'plc-datatype',
  } as const

  const handleCreateTab = ({ elementType, name, path }: TabsProps) => {
    let language
    let derivation
    const tabToBeCreated = {
      name,
      path,
      elementType,
    }
    updateTabs(tabToBeCreated)
    switch (elementType.type) {
      case 'program':
        language = elementType.language
        derivation = null
        break
      case 'function':
        language = elementType.language
        derivation = null
        break
      case 'function-block':
        language = elementType.language
        derivation = null
        break
      case 'data-type':
        derivation = elementType.derivation
        language = null
    }

    if (language === null && derivation !== null) {
      const editor = CreateEditorObject({
        type: editorType[derivation],
        name,
        derivation: derivation,
      })
      setEditor({ editor })
    }
    if (language !== null && derivation === null) {
      const pouType = elementType.type as 'program' | 'function' | 'function-block'
      const editor = CreateEditorObject({
        type: editorType[language],
        name,
        language: language,
        derivation: pouType,
      })
      setEditor({ editor })
    }
  }

  return (
    <div className='w-full'>
      {/* Actions handler */}
      <div id='project-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 px-2'>
        <div
          id='project-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'
        >
          <FolderIcon size='sm' />
          <span
            id='project-name'
            className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'
          >
            {Name}
          </span>
        </div>
        <div id='create-plc-container'>
          <CreatePLCElement />
        </div>
      </div>
      {/* Data display */}
      <ProjectTreeRoot label={Name}>
        <ProjectTreeBranch branchTarget='function'>
          {pous
            ?.filter(({ type }) => type === 'function')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                onClick={() =>
                  handleCreateTab({
                    name: data.name,
                    path: `/data/pous/function/${data.name}`,
                    elementType: { type: 'function', language: data.language },
                  })
                }
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='function-block'>
          {pous
            ?.filter(({ type }) => type === 'function-block')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                onClick={() =>
                  handleCreateTab({
                    name: data.name,
                    path: `/data/pous/function-block/${data.name}`,
                    elementType: { type: 'function-block', language: data.language },
                  })
                }
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='program'>
          {pous
            ?.filter(({ type }) => type === 'program')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                onClick={() =>
                  handleCreateTab({
                    name: data.name,
                    path: `/data/pous/program/${data.name}`,
                    elementType: { type: 'program', language: data.language },
                  })
                }
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='data-type'>
          <ProjectTreeNestedBranch nestedBranchTarget='array'>
            {dataTypes
              ?.filter(({ derivation }) => derivation.type === 'array')
              .map(({ id, name }) => (
                <ProjectTreeLeaf
                  nested
                  key={id}
                  leafLang='dt'
                  label={name}
                  /** Todo: Update the tab state */
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/data/data-types/array/${name}`,
                      elementType: { type: 'data-type', derivation: 'array' },
                    })
                  }
                />
              ))}
          </ProjectTreeNestedBranch>
          <ProjectTreeNestedBranch nestedBranchTarget='enumerated'>
            {dataTypes
              ?.filter(({ derivation }) => derivation.type === 'enumerated')
              .map(({ id, name }) => (
                <ProjectTreeLeaf
                  nested
                  key={id}
                  leafLang='dt'
                  label={name}
                  /** Todo: Update the tab state */
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/data/data-types/enumerated/${name}`,
                      elementType: { type: 'data-type', derivation: 'enumerated' },
                    })
                  }
                />
              ))}
          </ProjectTreeNestedBranch>
          <ProjectTreeNestedBranch nestedBranchTarget='structure'>
            {dataTypes
              ?.filter(({ derivation }) => derivation.type === 'structure')
              .map(({ id, name }) => (
                <ProjectTreeLeaf
                  nested
                  key={id}
                  leafLang='dt'
                  label={name}
                  /** Todo: Update the tab state */
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/data/data-types/structure/${name}`,
                      elementType: { type: 'data-type', derivation: 'structure' },
                    })
                  }
                />
              ))}
          </ProjectTreeNestedBranch>
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='device'>{/** Will be filled with device */}</ProjectTreeBranch>
        {/** Maybe a divider component */}
        {/* <ProjectTreeBranch branchTarget='' label='Resources' /> */}
      </ProjectTreeRoot>
    </div>
  )
}
export { Project }
