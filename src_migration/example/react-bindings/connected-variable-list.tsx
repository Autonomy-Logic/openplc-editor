import { VariableListView } from '../frontend'
import { useVariableListController } from './controller-context'
import { useReadModel } from './use-read-model'

/** Glue only: takes the injected controller, subscribes to its model and hands both to the view. */
export function ConnectedVariableList() {
  const controller = useVariableListController()
  const model = useReadModel(controller.model)
  return <VariableListView model={model} intents={controller} />
}
