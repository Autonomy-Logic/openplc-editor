import { z } from 'zod';
import { ThemeSchema } from './validations/theme';

export namespace api {
  export namespace Types {
    /**
     * Basic structure to create a project
     * @readonly - Intern use only.
     */
    type Service = {};

    export interface IProjectService extends Service {
      createProject: () => Promise<Dtos.TProject>;
      openProject: () => Promise<Dtos.Response>;
      saveProject: ({
        path,
        data,
      }: Dtos.IProjectData) => Promise<Dtos.Response>;
    }

    type Theme = z.infer<typeof ThemeSchema>;

    //REVIEW
    export interface IThemeProps extends Record<string, unknown> {
      theme: Theme;
    }
  }

  export namespace Dtos {
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

    export type TProject = Response<{
      projectPath: string;
      projectAsObj: object;
    }>;

    export interface IProjectData {
      path: string;
      data: object;
    }
  }
}
