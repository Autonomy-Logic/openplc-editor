import { CONSTANTS } from '@shared/constants'
import { FC, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Tabs } from '@/components'
import Tree, { RootProps } from '@/components/Tree'
import { useProject } from '@/hooks'

const { paths } = CONSTANTS

const ProjectTree: FC = () => {
  const { project } = useProject()
  const [root, setRoot] = useState<RootProps>()
  const navigate = useNavigate()

  useEffect(() => {
    if (project && project?.xmlSerialized) {
      const { xmlSerialized } = project
      setRoot({
        id: 'root',
        title: 'root',
        children: [
          {
            id: 'product-name',
            title: xmlSerialized?.project?.fileHeader?.['@productName'],
            icon: () => (
              <div className="flex h-5 w-5 items-center justify-center border-2 border-gray-500 px-1">
                <div className="-ml-1 -mt-1 -rotate-45">
                  <span className="text-[0.5rem] font-bold text-gray-500">
                    PLC
                  </span>
                </div>
              </div>
            ),
            children: [
              ...Object.keys(xmlSerialized?.project?.types?.pous).map(
                (key, index) => ({
                  id: `pou-name-${index}`,
                  title: xmlSerialized?.project?.types?.pous?.[key]?.['@name'],
                }),
              ),
              {
                id: 'resource-name',
                title:
                  xmlSerialized?.project?.instances?.configurations
                    ?.configuration?.resource?.['@name'],
              },
            ],
          },
        ],
      })
    } else {
      navigate(paths.HOME)
    }
  }, [navigate, project])

  return (
    <>
      <Tabs
        tabs={[
          {
            id: project?.xmlSerialized?.project?.fileHeader?.['@productName'],
            name: project?.xmlSerialized?.project?.fileHeader?.['@productName'],
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
