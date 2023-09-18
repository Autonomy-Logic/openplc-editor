import { CONSTANTS } from '@shared/constants'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { Tabs } from '@/components'
import Tree, { RootProps } from '@/components/Tree'
import { useProject, useTabs } from '@/hooks'
import { convertToPath } from '@/utils'
/**
 * Destructure necessary values from the CONSTANTS module
 */
const { paths } = CONSTANTS
/**
 * Functional component for displaying the project tree
 * @component
 */
const ProjectTree: FC = () => {
  /**
   * Access the project and related functions from custom hook
   * @useProject
   */
  const { currentProject, getXmlSerializedValueByPath } = useProject()
  /**
   * Access the addTab function from custom hook
   * @useTabs
   */
  const { addTab } = useTabs()
  /**
   * State for holding the root structure of the tree
   * @type {RootProps | undefined}
   */
  const [root, setRoot] = useState<RootProps>()
  /**
   * Access the translation function from 'react-i18next'
   * @useTranslation
   */
  const { t } = useTranslation()
  /**
   * Access the navigation function from 'react-router-dom'
   * @useNavigate
   */
  const navigate = useNavigate()
  /**
   * Extract the product name from the project XML or use an empty string
   */
  const productName =
    (getXmlSerializedValueByPath(
      'project.fileHeader.@productName',
    ) as string) || ''

  useEffect(() => {
    if (currentProject && currentProject?.xmlSerializedAsObject) {
      const pous = getXmlSerializedValueByPath(
        'project.types.pous',
      ) as XMLSerializedAsObject
      const resourceName = getXmlSerializedValueByPath(
        'project.instances.configurations.configuration.resource.@name',
      ) as string | ''
      /**
       * Handle click events for tree nodes and add corresponding tabs
       * @function
       */
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
      /**
       * Construct the root structure of the tree
       */
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
  }, [
    addTab,
    getXmlSerializedValueByPath,
    navigate,
    productName,
    currentProject,
    t,
  ])
  /**
   * Render the ProjectTree component
   * @returns JSX Element
   */
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
