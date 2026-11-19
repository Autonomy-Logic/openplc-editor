// Public entry of the application layer. Layers that only implement ports import `application/ports` instead.
export type {
  DocumentActivity,
  OperationFailure,
  PersistenceLoadResult,
  PersistenceSaveResult,
  VariableDocumentState,
  VariableDocumentStatePort,
  VariablePersistencePort,
} from './ports'
export {
  createVariableListService,
  type VariableListService,
  type VariableListServiceDependencies,
} from './variable-list-service'
