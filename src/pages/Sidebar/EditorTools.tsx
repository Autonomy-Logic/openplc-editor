import { FC, Fragment, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { IconType } from 'react-icons'
import { useReactFlow, useStore } from 'reactflow'
import { gray } from 'tailwindcss/colors'

import { PowerRailProperties, Tooltip } from '@/components'
import { useModal } from '@/hooks'

export type EditorToolsProps = {
  id: number
  icon: IconType
  className?: string
  onClick?: () => void
  tooltip: string
}

let currentOverlapOffset = 0
const OVERLAP_OFFSET = 10
const NODE_WIDTH = 200
const NODE_HEIGHT = 200

const EditorTools: FC = () => {
  const { t } = useTranslation('editorTools')
  const { addNodes } = useReactFlow()
  const [transformX, transformY, zoomLevel] = useStore(
    ({ transform }) => transform,
  )
  const height = useStore(({ height }) => height)
  const width = useStore(({ width }) => width)

  const getNodePosition = useCallback(() => {
    const zoomMultiplier = 1 / zoomLevel
    const centerX = -transformX * zoomMultiplier + (width * zoomMultiplier) / 2
    const centerY = -transformY * zoomMultiplier + (height * zoomMultiplier) / 2
    const nodeWidthOffset = NODE_WIDTH / 2
    const nodeHeightOffset = NODE_HEIGHT / 2
    currentOverlapOffset += OVERLAP_OFFSET

    return {
      x: centerX - nodeWidthOffset + currentOverlapOffset,
      y: centerY - nodeHeightOffset + currentOverlapOffset,
    }
  }, [height, transformX, transformY, width, zoomLevel])

  const { handleOpenModal } = useModal({
    content: <PowerRailProperties position={getNodePosition()} />,
    hideCloseButton: true,
  })

  const handleAddComment = useCallback(() => {
    addNodes({
      id: crypto.randomUUID(),
      type: 'comment',
      position: getNodePosition(),
      data: {},
    })
  }, [addNodes, getNodePosition])

  const tools: EditorToolsProps[] = [
    {
      id: 1,
      onClick: handleAddComment,
      icon: () => (
        <div
          className="flex h-24 w-24 justify-center rounded pt-8 shadow-[-2px_2px_2px_0px_rgba(0,0,0,0.1)]"
          style={{
            background: `linear-gradient(to left bottom, transparent 50%,${gray[200]} 0 ) no-repeat 100% 0 / 2em 2em,linear-gradient(-135deg, transparent 1.41em, white 0)`,
          }}
        >
          <span className="mt-3 text-center text-sm font-semibold leading-6">
            {t('comment.label')}
          </span>
        </div>
      ),
      tooltip: t('comment.tooltip'),
    },
    {
      id: 2,
      onClick: handleOpenModal,
      icon: () => (
        <div className="mx-6 flex h-24 w-1 flex-col justify-around rounded bg-black">
          <div className="h-[0.125rem] w-6 bg-black" />
          <div className="h-[0.125rem] w-6 bg-black" />
          <div className="h-[0.125rem] w-6 bg-black" />
        </div>
      ),
      tooltip: t('powerRail'),
    },
  ]

  return (
    <div className="mt-10 grid grid-cols-3 gap-4">
      {tools.map(({ id, onClick, icon: Icon, tooltip }) => (
        <Fragment key={id}>
          <Tooltip id={tooltip} label={tooltip} place="bottom">
            <div className="flex justify-center">
              <button
                className="press-animated w-fit"
                onClick={() => onClick && onClick()}
              >
                <Icon />
              </button>
            </div>
          </Tooltip>
        </Fragment>
      ))}
    </div>
  )
}

export default EditorTools
