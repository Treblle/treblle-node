declare module "treblle" {
  type OptionsBase = {
    apiKey: string;
    projectId: string;
    additionalFieldsToMask?: string[];
    showErrors?: boolean;
    blocklistPaths?: string[]|RegExp;
  };

  type StrapiOptionsBase = {
    apiKey: string;
    projectId: string;
    additionalFieldsToMask?: string[];
    showErrors?: boolean;
    blocklistPaths?: string[]|RegExp;
    ignoreAdminRoutes?: string[];
  };

  type FetchEvent = any;
  type Request = any;
  type Response = any;

  export function useTreblle(app: any, options: any): void;

  export function koaTreblle(
   options: OptionsBase
  ): Function;

  export function strapiTreblle(
    options: StrapiOptionsBase
  ): Function;

  export function serviceWorkerTreblle(
    options: OptionsBase
  ): (event: FetchEvent) => void;

  export function moduleWorkerTreblle(
    options: OptionsBase
  ): (request: Request) => Promise<Response> | Response;

  export function useNestTreblle(app: any, options: OptionsBase): void;
}
