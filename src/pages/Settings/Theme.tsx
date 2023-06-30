import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { darkTheme, lightTheme } from '@/assets/png'
import { useTheme } from '@/hooks'
import { classNames } from '@/utils'

const Theme: FC = () => {
  const { t } = useTranslation('settings')
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  const handleSetDarkTheme = () => !isDark && toggleTheme()
  const handleSetLightTheme = () => isDark && toggleTheme()
  return (
    <div className="my-10 flex w-full items-center gap-x-8">
      <div className="flex flex-col items-center justify-center rounded-sm">
        <p className="mb-3 text-xs font-semibold">{t('theme.light')}</p>
        <button
          onClick={handleSetLightTheme}
          className={classNames(
            'rounded p-1',
            !isDark && ' border-2 border-open-plc-blue',
          )}
        >
          <img src={lightTheme} className="h-16 w-16 text-gray-800" alt="" />
        </button>
      </div>
      <div className="flex flex-col items-center justify-center rounded-sm">
        <p className="mb-3 text-xs font-semibold">{t('theme.dark')}</p>
        <button
          onClick={handleSetDarkTheme}
          className={classNames(
            'rounded p-1',
            isDark && 'border-2 border-open-plc-blue',
          )}
        >
          <img src={darkTheme} className="h-16 w-16 text-gray-800" alt="" />
        </button>
      </div>
    </div>
  )
}

export default Theme
