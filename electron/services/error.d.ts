export type ServiceError = {
  ok: boolean;
  reason?: {
    title: string;
    description?: string;
  };
};
