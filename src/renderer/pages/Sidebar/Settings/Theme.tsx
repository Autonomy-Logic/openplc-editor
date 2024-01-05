/* eslint-disable react/function-component-definition */
/* eslint-disable react/button-has-type */
/* eslint-disable import/no-cycle */
import { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { classNames } from '../../../../utils';
import { darkTheme, lightTheme } from '../../../assets';
import { useTheme } from '../../../hooks';
/**
 * Functional component for managing the theme settings
 * @component
 */
const Theme: FC = () => {
  /**
   * Access the translation function from 'react-i18next'
   * @useTranslation
   */
  const { t } = useTranslation('settings');
  /**
   * Access the theme and theme toggling function from custom hook
   * @useTheme
   */
  const { theme, toggleTheme } = useTheme();
  /**
   * Determine if the current theme is dark
   * @type {boolean}
   */
  const isDark: boolean = theme === 'dark';
  /**
   * Toggle the theme to dark if not already dark
   * @function
   */
  const handleSetDarkTheme = () => !isDark && toggleTheme();
  /**
   * Toggle the theme to light if not already light
   * @function
   */
  const handleSetLightTheme = () => isDark && toggleTheme();
  /**
   * Render the theme settings UI
   * @returns JSX Element
   */
  return (
    <div className="my-10 flex w-full items-center gap-x-8">
      <div className="flex flex-col items-center justify-center rounded-sm">
        <p className="mb-3 text-xs font-semibold">{t('theme.light')}</p>
        <button
          onClick={handleSetLightTheme}
          className={classNames(
            'rounded p-1',
            !isDark && ' border-2 border-brand',
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
            isDark && 'border-2 border-brand',
          )}
        >
          <img src={darkTheme} className="h-16 w-16 text-gray-800" alt="" />
        </button>
      </div>
    </div>
  );
};

export default Theme;
