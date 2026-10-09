import styles from './variable-list.module.css'

/**
 * Recipe: the layout and appearance of a composed pattern (the variable list), kept in the design system
 * so the view in `frontend` holds structure only. Views use these named keys, never the stylesheet directly.
 */
export const variableListRecipe = {
  panel: styles.panel,
  header: styles.header,
  title: styles.title,
  addForm: styles.addForm,
  rows: styles.rows,
  row: styles.row,
  name: styles.name,
  type: styles.type,
  renameField: styles.renameField,
  empty: styles.empty,
} as const
