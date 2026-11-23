import type { UsersInfoRawFacts } from './runtime-port'
import type { Unsubscribe } from './types'

export type SshBannerReadResult = { kind: 'data'; text: string } | { kind: 'error'; code?: string; timedOut: boolean }

export interface SshBannerProbeMechanism {
  read(request: { host: string; port: number; timeoutMs: number; maxBytes: number }): Promise<SshBannerReadResult>
}

export type SshAuthChoice = 'none' | 'password' | 'stop'

export interface SshSessionOpenRequest {
  host: string
  port: number
  username: string
  password: string
  timeoutMs: number
  keepaliveIntervalMs: number
  keepaliveCountMax: number
  verifyHostKey: (keyBase64: string) => Promise<boolean>
  chooseAuth: (methodsLeft: string[] | null) => SshAuthChoice
}

export interface SshExecResult {
  exitCode: number | null
  stdout: string
  stdoutBytes: Uint8Array
  stderr: string
  truncated: boolean
}

export interface SshExecOptions {
  stdin?: string
  maxOutputBytes: number
  timeoutMs: number
}

export interface SshSession {
  exec(command: string, options: SshExecOptions): Promise<SshExecResult>
  close(): void
  onClosed(callback: () => void): Unsubscribe
}

export type SshSessionOpenResult =
  | { kind: 'open'; session: SshSession }
  | { kind: 'error'; level?: string; code?: string; message: string }

export interface SshSessionMechanism {
  open(request: SshSessionOpenRequest): Promise<SshSessionOpenResult>
}

export type HostKeyFileReadResult =
  | { kind: 'absent' }
  | { kind: 'text'; text: string }
  | { kind: 'error'; message: string }

export interface HostKeyFileMechanism {
  read(): Promise<HostKeyFileReadResult>
  replace(text: string): Promise<void>
}

export interface RuntimeReachabilityMechanism {
  check(host: string): Promise<UsersInfoRawFacts>
}

export interface ClockMechanism {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export interface AuditSink {
  write(line: string): void
}

export interface RuntimeProvisioningMechanisms {
  bannerProbe: SshBannerProbeMechanism
  sshSession: SshSessionMechanism
  hostKeyFile: HostKeyFileMechanism
  reachability: RuntimeReachabilityMechanism
  clock: ClockMechanism
  audit: AuditSink
}
