export interface GetProjectProps {
  ok: boolean
  reason?: { title: string; description?: string }
  data?: { filePath: string; xmlProject: any }
}
