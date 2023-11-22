/* eslint-disable react/function-component-definition */
/* eslint-disable import/no-cycle */
import { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs } from '../../../components';
import Theme from './Theme';
/**
 * Functional component for managing settings
 * @component
 */
const Settings: FC = () => {
  /**
   * Access the translation function from 'react-i18next'
   * @useTranslation
   */
  const { t } = useTranslation('settings');
  /**
   * Render the Settings component
   * @returns JSX Element
   */
  return (
    <>
      <Tabs
        tabs={[
          /**
           * Tab ID and title fetched from translations
           * @t('theme.tabName') Get the translated tab ID
           */
          {
            id: t('theme.tabName'),
            title: t('theme.tabName'),
            current: true,
          },
        ]}
      />
      <Theme />
    </>
  );
};

export default Settings;
