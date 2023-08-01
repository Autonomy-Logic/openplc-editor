export const CONSTANTS = {
  theme: {
    variants: {
      LIGHT: 'light',
      DARK: 'dark',
    },
  },
  channels: {
    get: {
      THEME: 'get_theme',
      PROJECT: 'get_project',
      SAVE_PROJECT: 'get_project_to_save',
      CREATE_POU_WINDOW: 'get_create_pou_window',
      TOAST: 'get_toast',
    },
    set: {
      THEME: 'set_theme',
      CREATE_CHILD_WINDOW: 'set_create_child_window',
      CREATE_PROJECT_FROM_TOOLBAR: 'set_create_project_from_toolbar',
      UPDATE_MENU_PROJECT: 'set_update_menu_project',
      SAVE_PROJECT: 'set_project_to_save',
    },
  },
  paths: {
    MAIN: '/',
    PROJECT: 'project',
    POU: 'pou',
    RES: 'res',
  },
  types: {
    PROGRAM: 'program',
  },
  languages: {
    IL: 'IL',
    ST: 'ST',
    LD: 'LD',
    FBD: 'FBD',
    SFC: 'SFC',
  },
}
