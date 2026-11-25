import type {
  RunRequestField,
  RuntimeProvisioningEvent,
  RuntimeProvisioningOperation,
  RuntimeProvisioningOutcome,
  RuntimeProvisioningPhase,
} from '../../../../middleware/shared/ports/runtime-provisioning-port'

export type RuntimeProvisioningNotice =
  | { kind: 'login-rejected' }
  | { kind: 'input-refused'; field: RunRequestField | 'payload' }

export type RuntimeProvisioningView =
  | { stage: 'idle' }
  | { stage: 'offer'; host: string; sshPort: number; notice: RuntimeProvisioningNotice | null }
  | {
      stage: 'running'
      host: string
      sshPort: number
      operationId: number
      startedAt: number
      phase: RuntimeProvisioningPhase
      operation: RuntimeProvisioningOperation | null
      cancellable: boolean
      latestLine: string | null
      lines: string[]
    }
  | {
      stage: 'ended'
      host: string
      sshPort: number
      operationId: number
      startedAt: number
      endedAt: number
      outcome: RuntimeProvisioningOutcome
      lines: string[]
      acknowledged: boolean
    }

export interface RuntimeProvisioningState {
  view: RuntimeProvisioningView
  dialogVisible: boolean
  sessionSshPorts: Record<string, number>
  detachRequested: boolean
}

export interface RuntimeProvisioningActions {
  showOffer(host: string, sshPort: number): void
  setOfferNotice(notice: RuntimeProvisioningNotice | null): void
  declineOffer(): void
  startRun(input: { host: string; sshPort: number; operationId: number; startedAt: number }): void
  applyEvent(event: RuntimeProvisioningEvent): void
  finishRun(outcome: RuntimeProvisioningOutcome, endedAt: number): void
  setDialogVisible(visible: boolean): void
  acknowledgeEnding(): void
  rememberSshPort(host: string, port: number): void
  requestDetachOnProjectClose(): void
  clearDetachRequest(): void
}

export type RuntimeProvisioningSlice = {
  runtimeProvisioning: RuntimeProvisioningState
  runtimeProvisioningActions: RuntimeProvisioningActions
}
