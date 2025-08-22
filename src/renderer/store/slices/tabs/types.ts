import { z } from 'zod'

const tabsPropsSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  /** TODO:Here must be added a validation to turn the lang required if the elementType is a pou */
  elementType: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('program'),
      language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd', 'python']),
    }),
    z.object({
      type: z.literal('function'),
      language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd', 'python']),
    }),
    z.object({
      type: z.literal('function-block'),
      language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd', 'python']),
    }),
    z.object({
      type: z.literal('data-type'),
      derivation: z.enum(['enumerated', 'structure', 'array']),
    }),
    z.object({
      type: z.literal('resource'),
    }),
    z.object({
      type: z.literal('device'),
      derivation: z.enum(['configuration']),
    }),
  ]),
  configuration: z.object({}).optional(),
})

type TabsProps = z.infer<typeof tabsPropsSchema>
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
const _tabsActionsSchema = z.object({
  setTabs: z.function().args(z.array(tabsPropsSchema)).returns(z.void()),
  updateTabs: z.function().args(tabsPropsSchema).returns(z.void()),
  sortTabs: z.function().args(z.array(tabsPropsSchema)).returns(z.void()),
  removeTab: z.function().args(z.string()).returns(z.void()),
  clearTabs: z.function().returns(z.void()),
  updateTabName: z.function().args(z.string(), z.string()).returns(z.void()),
})

/** The state, the source of truth that drives our app. - Concept based on Redux */
type TabsState = z.infer<typeof tabsStateSchema>
/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type TabsActions = z.infer<typeof _tabsActionsSchema>
type TabsSlice = TabsState & {
  tabsActions: TabsActions
}

export { tabsPropsSchema, tabsStateSchema }

export type { TabsActions, TabsProps, TabsSlice, TabsState }
