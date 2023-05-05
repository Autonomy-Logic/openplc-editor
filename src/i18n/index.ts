import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enUS from './locales/en-US/translation.json';

const resources = {
  'en-US': {
    translation: enUS,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: navigator.language,
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
