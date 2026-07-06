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

  /**
   * Records a database query against the currently in-flight request so it is
   * included in the Treblle payload's `data.queries` array. Store only the
   * parameterized SQL string (never the parameter bindings) to avoid capturing
   * sensitive data. No-op when called outside of a tracked request.
   *
   * @param sql the (parameterized) SQL query string
   * @param time query execution time in milliseconds
   */
  export function trackQuery(sql: string, time: number): void;
}
