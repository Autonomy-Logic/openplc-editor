import { CONSTANTS } from '@shared/constants'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Tabs } from '@/components'
import Tree, { RootProps } from '@/components/Tree'
import { useProject, useTabs } from '@/hooks'

const { paths } = CONSTANTS

const ProjectTree: FC = () => {
  const { project } = useProject()
  const { addTab, removeTab, currentTab } = useTabs()
  const [root, setRoot] = useState<RootProps>()
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    if (project && project?.xmlSerialized) {
      const { xmlSerialized } = project
      const productName = xmlSerialized?.project?.fileHeader?.['@productName']
      const pous = xmlSerialized?.project?.types?.pous
      const resourceName =
        xmlSerialized?.project?.instances?.configurations?.configuration
          ?.resource?.['@name']
      setRoot({
        id: 'root',
        title: 'root',
        children: [
          {
            id: productName,
            title: productName,
            children: [
              {
                id: 'programs',
                title: t('programs'),
                children: [
                  ...Object.keys(pous).map((key) => {
                    const pouName = pous?.[key]?.['@name']
                    return {
                      id: pouName,
                      title: pouName,
                      onClick: () =>
                        addTab({
                          id: pouName,
                          title: pouName,
                          onClick: () => currentTab(pouName),
                          onClickCloseButton: () => removeTab(pouName),
                        }),
                    }
                  }),
                ],
              },
              {
                id: resourceName,
                title: resourceName,
                onClick: () =>
                  addTab({
                    id: resourceName,
                    title: resourceName,
                    onClick: () => currentTab(resourceName),
                    onClickCloseButton: () => removeTab(resourceName),
                  }),
              },
            ],
          },
        ],
      })
    } else {
      navigate(paths.HOME)
    }
  }, [addTab, currentTab, navigate, project, removeTab, t])

  return (
    <>
      <Tabs
        tabs={[
          {
            id: project?.xmlSerialized?.project?.fileHeader?.['@productName'],
            title:
              project?.xmlSerialized?.project?.fileHeader?.['@productName'],
            current: true,
          },
        ]}
      />
      <div className="py-4">
        <Tree root={root} />
      </div>
    </>
  )
}

export default ProjectTree
