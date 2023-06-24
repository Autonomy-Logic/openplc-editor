import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs } from '@/components'

const BottomRow: FC = () => {
  const { t } = useTranslation('bottomRowTabs')

  const [current, setCurrent] = useState(0)

  const bottomRowTabs = [
    {
      id: 0,
      name: t('search'),
      onClick: () => setCurrent(0),
      current: current === 0,
    },
    {
      id: 1,
      name: t('console'),
      onClick: () => setCurrent(1),
      current: current === 1,
    },
    {
      id: 2,
      name: t('plcLog'),
      onClick: () => setCurrent(2),
      current: current === 2,
    },
  ]

  return (
    <footer>
      <Tabs tabs={bottomRowTabs} />
    </footer>
  )
}

export default BottomRow
