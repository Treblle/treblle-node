declare module "treblle" {
  type OptionsBase = {
    apiKey: string;
    projectId: string;
    additionalFieldsToMask?: string[];
    showErrors?: boolean;
    blacklistPaths?: string[]|RegExp;
  };

  type FetchEvent = any;
  type Request = any;
  type Response = any;

  export function useTreblle(app: any, options: any): void;

  export function koaTreblle(
    apiKey: string,
    projectId: string,
    additionalFieldsToMask?: any[],
    blacklistPaths?: string[]|RegExp,
    showErrors?: boolean
  ): Function;

  export function strapiTreblle(
    apiKey: string,
    projectId: string,
    additionalFieldsToMask?: any[],
    showErrors?: boolean,
    blacklistPaths?: string[]|RegExp,
    ignoreAdminRoutes?: string[]
  ): Function;

  export function serviceWorkerTreblle(
    options: OptionsBase
  ): (event: FetchEvent) => void;

  export function moduleWorkerTreblle(
    options: OptionsBase
  ): (request: Request) => Promise<Response> | Response;

  export function useNestTreblle(app: any, options: OptionsBase): void;
}
