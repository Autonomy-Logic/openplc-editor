import { CONSTANTS } from '@shared/constants'
import { XMLSerializedAsObjectProps } from '@shared/types/xmlSerializedAsObject'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Tabs } from '@/components'
import Tree, { RootProps } from '@/components/Tree'
import { useProject, useTabs } from '@/hooks'
import { convertToPath } from '@/utils'

const { paths } = CONSTANTS

const ProjectTree: FC = () => {
  const { project, getXmlSerializedValueByPath } = useProject()
  const { addTab } = useTabs()
  const [root, setRoot] = useState<RootProps>()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const productName =
    (getXmlSerializedValueByPath(
      'project.fileHeader.@productName',
    ) as string) || ''

  useEffect(() => {
    if (project && project?.xmlSerializedAsObject) {
      const pous = getXmlSerializedValueByPath(
        'project.types.pous',
      ) as XMLSerializedAsObjectProps
      const resourceName = getXmlSerializedValueByPath(
        'project.instances.configurations.configuration.resource.@name',
      ) as string | ''

      const handleClick = (data: {
        id: number | string
        title: string
        path: string
      }) => {
        addTab({
          ...data,
          onClick: () => navigate(data.path),
        })
        navigate(data.path)
      }

      setRoot({
        id: 'root',
        title: 'root',
        children: [
          {
            id: productName,
            title: productName,
            onClick: () =>
              handleClick({
                id: productName,
                title: productName,
                path: paths.PROJECT,
              }),
            isOpen: true,
            children: [
              {
                id: 'programs',
                title: t('programs'),
                isOpen: true,
                children: [
                  ...Object.keys(pous).map((key) => {
                    const pouName =
                      (getXmlSerializedValueByPath(
                        `project.types.pous.${key}.@name`,
                      ) as string) || ''
                    return {
                      id: pouName,
                      title: pouName,
                      onClick: () =>
                        handleClick({
                          id: pouName,
                          title: pouName,
                          path: convertToPath([paths.POU, pouName]),
                        }),
                    }
                  }),
                ],
              },
              {
                id: resourceName,
                title: resourceName,
                onClick: () =>
                  handleClick({
                    id: resourceName,
                    title: resourceName,
                    path: paths.RES,
                  }),
              },
            ],
          },
        ],
      })
    } else {
      navigate(paths.MAIN)
    }
  }, [addTab, getXmlSerializedValueByPath, navigate, productName, project, t])

  return (
    <>
      <Tabs
        tabs={[
          {
            id: productName,
            title: productName,
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
