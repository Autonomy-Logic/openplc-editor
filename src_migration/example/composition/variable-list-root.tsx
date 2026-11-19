import type { VariableListController } from '../contracts/presentation'
import { type Theme, ThemeRoot } from '../design-system'
import { ConnectedVariableList, VariableListControllerProvider } from '../react-bindings'

export interface VariableListRootProps {
  readonly controller: VariableListController
  readonly theme?: Theme
}

/** React root of the feature. It accepts any controller, so the same tree renders the real app or a fixture. */
export function VariableListRoot({ controller, theme = 'system' }: VariableListRootProps) {
  return (
    <ThemeRoot theme={theme}>
      <VariableListControllerProvider controller={controller}>
        <ConnectedVariableList />
      </VariableListControllerProvider>
    </ThemeRoot>
  )
}
