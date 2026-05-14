/**
 * Shared submit handler for the new-project flow.
 *
 * Step 2 (library projects' final step) and Step 3 (PLC projects'
 * final step) both call `createProject` with the same set of
 * concerns: persist the form snapshot back to the store, fire the
 * IPC, surface failures via toast (without dismissing the modal so
 * the user can retry), and on success hand the response to the
 * workspace + close the modal.  Extracting it here keeps the two
 * step components from drifting; a fix to one is a fix to both.
 */

import { useProject } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { useToast } from '../../[app]/toast/use-toast'
import { NewProjectStore } from './store'

interface CreateProjectFormData {
  name: string
  path: string
  type: string
  language: string
  time: string
}

interface SubmitCallbacks {
  /** Run only on a successful project creation — modal dismissal,
   *  parent state resets, etc.  A failure leaves the modal open so
   *  the user can adjust the inputs and resubmit. */
  onSuccess: () => void
}

export function useCreateProjectSubmit() {
  const { toast } = useToast()
  const project = useProject()
  const handleUpdateForm = NewProjectStore((state) => state.setFormData)
  const {
    sharedWorkspaceActions: { handleOpenProjectResponse },
  } = useOpenPLCStore()

  return async function submit(allData: CreateProjectFormData, { onSuccess }: SubmitCallbacks): Promise<void> {
    handleUpdateForm(allData)

    try {
      const result = await project.createProject({
        name: allData.name,
        type: allData.type as 'plc-project' | 'plc-library',
        path: allData.path,
        language: allData.language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd',
        time: allData.time,
      })

      if (!result.success || !result.data) {
        toast({
          title: 'Cannot create a project!',
          description: result.error?.description ?? 'Failed to create the project.',
          variant: 'fail',
        })
        return
      }

      handleOpenProjectResponse(result.data)
      onSuccess()
    } catch (_error) {
      toast({
        title: 'Cannot create a project!',
        description: 'Failed to create the project.',
        variant: 'fail',
      })
    }
  }
}
