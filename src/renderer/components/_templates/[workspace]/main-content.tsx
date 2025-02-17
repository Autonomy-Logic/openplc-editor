import { useOpenPLCStore } from '@root/renderer/store'
import { TabsProps } from '@root/renderer/store/slices'
import { CreateEditorObjectFromTab } from '@root/renderer/store/slices/tabs/utils'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, useEffect } from 'react'

type IWorkspaceMainContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceMainContent = (props: IWorkspaceMainContentProps) => {
  const {
    editors,
    project: {
      data: { pous },
    },
    workspace: {
      systemConfigs: { OS },
    },

    tabsActions: { updateTabs },
    editorActions: { addModel, setEditor },
  } = useOpenPLCStore()
  const { children, ...res } = props

  useEffect(() => {
    // Bad code! - this is only for development purpose
    if (pous.length !== 0) {
      const handleCreateTab = () => {
        const mainPou = pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
        if (!mainPou) return

        const tabToBeCreated: TabsProps = {
          name: mainPou.data.name,
          path: '/data/pous/program/main',
          elementType: { type: 'program', language: mainPou.data.language },
        }
        updateTabs(tabToBeCreated)
        const model = CreateEditorObjectFromTab(tabToBeCreated)
        const modelFound = editors.find((editor) => editor.meta.name === model.meta.name)
        if (modelFound) {
          setEditor(modelFound)
          return
        }

        addModel(model)
        setEditor(model)
        return
      }
      handleCreateTab()
    }
  }, [])

  return (
    <div
      className={cn(
        'flex h-full w-full flex-1 flex-grow gap-1 bg-neutral-100 p-2 dark:bg-neutral-900',
        `${OS !== 'linux' && '!rounded-tl-lg'}`,
      )}
      {...res}
    >
      {children}
    </div>
  )
}
export { WorkspaceMainContent }
