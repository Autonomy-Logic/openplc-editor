import { createSelectorHooks } from 'auto-zustand-selectors-hook';
import { create } from 'zustand';

/**
 * Import all slices to create the store.
 */
import createWorkspaceSlice, {
  WorkspaceSlice as WorkspaceSliceType,
} from './slices/workspace-slice';

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<WorkspaceSliceType>()((...a) => ({
  ...createWorkspaceSlice(...a),
}));

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
const useOpenPLCStore = createSelectorHooks(openPLCStoreBase);

/**
 * @exports useOpenPLCStore
 */
export default useOpenPLCStore;
