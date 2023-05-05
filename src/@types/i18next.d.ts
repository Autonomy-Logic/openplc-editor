import 'i18next';

import enUS from '../i18n/locales/en-US/translation.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'en-US';
    resources: {
      'en-US': typeof enUS;
    };
  }
}
