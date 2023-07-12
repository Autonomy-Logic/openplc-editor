import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs } from '@/components'

import Theme from './Theme'

const Settings: FC = () => {
  const { t } = useTranslation('settings')

  return (
    <>
      <Tabs
        tabs={[
          {
            id: t('theme.tabName'),
            title: t('theme.tabName'),
            current: true,
          },
        ]}
      />
      <Theme />
    </>
  )
}

export default Settings
