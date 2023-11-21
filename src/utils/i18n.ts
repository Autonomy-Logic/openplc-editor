import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import * as en from '../locales/en';

export const defaultNS = 'translation';
export const resources = { en } as const;

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: Object.keys(resources.en),
  defaultNS,
  resources,
  interpolation: {
    escapeValue: false,
  },
});

export { i18n };
