import { z } from 'zod'

const tabsPropsSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  /** TODO:Here must be added a validation to turn the lang required if the elementType is a pou */
  elementType: z.enum(['program', 'function', 'function-block', 'array', 'enumerated', 'structure']),
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).optional(),
})

/** This is a zod schema for the tabs slice state.
 * It is used to validate the tabs data if needed,
 * in most cases you can use the type inferred from it.
 */
const tabsStateSchema = z.object({
  tabs: z.array(tabsPropsSchema),
})

/** This is a zod schema for the tabs slice actions.
 * It is used to validate the tabs actions if needed,
 * in most cases you can use the type inferred from it.
 */
const tabsActionsSchema = z.object({
  setTabs: z.function().args(z.array(tabsPropsSchema)).returns(z.void()),
  updateTabs: z.function().args(tabsPropsSchema).returns(z.void()),
  sortTabs: z.function().args(z.array(tabsPropsSchema)).returns(z.void()),
  removeTab: z.function().args(z.string()).returns(z.void()),
  clearTabs: z.function().returns(z.void()),
})

/** The state, the source of truth that drives our app. - Concept based on Redux */
type TabsState = z.infer<typeof tabsStateSchema>
/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type TabsActions = z.infer<typeof tabsActionsSchema>
type TabsSlice = TabsState & {
  tabsActions: TabsActions
}

export { tabsStateSchema }

export type { TabsActions, TabsSlice, TabsState }
