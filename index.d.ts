declare module "treblle" {
  export type TreblleOptions = {
    /** Your Treblle SDK token */
    sdkToken: string;
    /** Your Treblle API key */
    apiKey: string;
    /**
     * Keywords to mask in request/response bodies and headers. Replaces the
     * default list; spread DEFAULT_MASKED_KEYWORDS to extend it, pass [] to
     * turn masking off.
     */
    maskedKeywords?: string[];
    /** Path prefixes or RegExp to exclude from tracking */
    blockedPaths?: string[] | RegExp;
    /** Show Treblle-related errors in the console */
    debug?: boolean;
    /** Custom Treblle ingress endpoint, e.g. "https://ingress-eu.treblle.com" */
    ingressEndpoint?: string;
  };

  export type StrapiTreblleOptions = TreblleOptions & {
    /** Admin route prefixes to skip (default: ["admin", "content-type-builder", "content-manager"]) */
    ignoreAdminRoutes?: string[];
  };

  export function useTreblle(app: any, options: TreblleOptions): any;

  export function useNestTreblle(app: any, options: TreblleOptions): any;

  export function koaTreblle(options: TreblleOptions): Function;

  export function strapiTreblle(options: StrapiTreblleOptions): Function;

  export function honoTreblle(options: TreblleOptions): Function;

  export function useFastifyTreblle(fastify: any, options: TreblleOptions): any;

  export function useNestFastifyTreblle(
    fastify: any,
    options: TreblleOptions,
  ): any;

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

  /** Allowed metadata value types */
  export type TreblleMetadataValue = string | number | boolean;

  /**
   * Attaches custom key/value metadata to the currently in-flight request so it
   * is included in the Treblle payload's `data.metadata` object (alongside
   * `data.request` / `data.response` / `data.queries`). Primarily used for
   * search and filtering. No-op when called outside of a tracked request.
   *
   * Keys and string values are length-limited, values must be strings, finite
   * numbers or booleans, and there is a cap on the number of keys per request;
   * anything over a limit is dropped or truncated. Metadata is NOT masked, so
   * never put secrets in it.
   *
   * @example
   * setMetadata("user-id", "john");
   * setMetadata({ plan: "premium", region: "eu" });
   */
  export function setMetadata(key: string, value: TreblleMetadataValue): void;
  export function setMetadata(
    metadata: Record<string, TreblleMetadataValue>,
  ): void;

  /** The default list of masked keywords */
  export const DEFAULT_MASKED_KEYWORDS: string[];
}

declare module "treblle/express" {
  import { TreblleOptions } from "treblle";
  export function useTreblle(app: any, options: TreblleOptions): any;
  export function useNestTreblle(app: any, options: TreblleOptions): any;
}

declare module "treblle/koa" {
  import { TreblleOptions, StrapiTreblleOptions } from "treblle";
  export function koaTreblle(options: TreblleOptions): Function;
  export function strapiTreblle(options: StrapiTreblleOptions): Function;
}

declare module "treblle/strapi" {
  import { TreblleOptions, StrapiTreblleOptions } from "treblle";
  export function koaTreblle(options: TreblleOptions): Function;
  export function strapiTreblle(options: StrapiTreblleOptions): Function;
}

declare module "treblle/hono" {
  import { TreblleOptions } from "treblle";
  export function honoTreblle(options: TreblleOptions): Function;
}

declare module "treblle/fastify" {
  import { TreblleOptions } from "treblle";
  export function useFastifyTreblle(fastify: any, options: TreblleOptions): any;
  export function useNestFastifyTreblle(
    fastify: any,
    options: TreblleOptions,
  ): any;
}
