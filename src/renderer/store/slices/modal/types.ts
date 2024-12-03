import { z } from 'zod'

const modalTypes = z.enum(['block-ladder-element', 'coil-ladder-element', 'contact-ladder-element'])
type ModalTypes = z.infer<typeof modalTypes>

const modalsState = z.record(
  modalTypes,
  z.object({
    open: z.boolean(),
    data: z.unknown(),
  }),
)
type ModalsState = z.infer<typeof modalsState>

const modalActions = z.object({
  openModal: z.function().args(modalTypes, z.unknown().optional()),
  onOpenChange: z.function().args(modalTypes, z.boolean()),
  closeModal: z.function(),
  getModalState: z
    .function()
    .args(modalTypes)
    .returns(z.object({ open: z.boolean(), data: z.any().optional() })),
})

const modalSlice = z.object({
  modals: modalsState,
  modalActions: modalActions,
})
type ModalSlice = z.infer<typeof modalSlice>

export { modalSlice, modalsState, modalTypes }
export type { ModalSlice, ModalsState, ModalTypes }
