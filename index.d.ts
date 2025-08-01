declare module "treblle" {
  type OptionsBase = {
    sdkToken: string;
    apiKey: string;
    additionalFieldsToMask?: string[];
    debug?: boolean;
    blocklistPaths?: string[] | RegExp;
  };

  type StrapiOptionsBase = {
    sdkToken: string;
    apiKey: string;
    additionalFieldsToMask?: string[];
    debug?: boolean;
    blocklistPaths?: string[] | RegExp;
    ignoreAdminRoutes?: string[];
  };

  type FetchEvent = any;
  type Request = any;
  type Response = any;

  // Augment Request interface for Cloudflare Workers route_path support
  interface CloudflareRequest extends Request {
    route_path?: string;
  }

  export function useTreblle(app: any, options: any): void;

  export function koaTreblle(options: OptionsBase): Function;

  export function strapiTreblle(options: StrapiOptionsBase): Function;

  export function serviceWorkerTreblle(
    options: OptionsBase
  ): (event: FetchEvent) => void;

  export function moduleWorkerTreblle(
    options: OptionsBase
  ): (request: Request) => Promise<Response> | Response;

  export function useNestTreblle(app: any, options: OptionsBase): void;

  export function honoTreblle(options: OptionsBase): Function;
}
