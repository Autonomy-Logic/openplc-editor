import { CONSTANTS } from '@shared/constants'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { Tabs } from '@/components'
import { convertToPath } from '@/utils'
const { paths } = CONSTANTS

const Settings: FC = () => {
  const { t } = useTranslation('settings')
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const themePath = convertToPath([paths.SETTINGS, paths.THEME])

  return (
    <>
      <Tabs
        tabs={[
          {
            id: t('theme.tabName'),
            name: t('theme.tabName'),
            current: pathname === themePath,
            onClick: () => navigate(themePath),
          },
        ]}
      />
      <Outlet />
    </>
  )
}

export default Settings
