// Public entry of the composition layer: factories for running instances and the React root.
export {
  createBrowserVariableListApp,
  createVariableListApp,
  VARIABLE_LIST_STORAGE_KEY,
  type VariableListApp,
  type VariableListAppOptions,
} from './create-variable-list-app'
export { VariableListRoot, type VariableListRootProps } from './variable-list-root'
