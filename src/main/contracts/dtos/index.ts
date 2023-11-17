/**
 * Represents the response format for service operations.
 * @template T - The type of data included in the response.
 */
type Response<T = unknown> = {
  /**
   * Indicates the success status of the service operation.
   */
  ok: boolean;
  /**
   * Optional details about the failure reason, if applicable.
   */
  reason?: {
    /**
     * Title describing the reason for failure.
     */
    title: string;
    /**
     * Additional description providing context about the failure.
     */
    description?: string;
  };
  /**
   * Optional data returned from the service operation.
   */
  data?: T;
};

export interface IGenericResponse extends Response {}

export type TProjectResponse = Response<{
  project: {
    path: string;
    data: object;
  };
}>;

export interface IProjectData {
  path: string;
  data: object;
}
