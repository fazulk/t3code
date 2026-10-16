import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

export {
  GitHubApiAuthenticationError,
  GitHubApiNotFoundError,
  GitHubApiRateLimitError,
  GitHubApiRequestError,
  GitHubApiResponseError,
  PinnedGitHubCredential,
  gitHubApiUrls,
  type GitHubApiError,
} from "./GitHubRequestPolicy.ts";
export type { GitHubRestInput, GitHubRestResponse } from "./GitHubRest.ts";

export interface GitHubGraphQlInput {
  readonly host: string;
  readonly operation: string;
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly allowReserve?: boolean;
  readonly maxResponseBytes?: number;
}

// Issue documents retain their schema decoders while sharing upstream's request policy.
export class GitHubApi extends Context.Service<
  GitHubApi,
  GitHubRest.GitHubRest["Service"] & {
    readonly graphql: (
      input: GitHubGraphQlInput,
    ) => Effect.Effect<string, GitHubRequestPolicy.GitHubApiError>;
  }
>()("@t3tools/source-control-github/server/GitHubApi") {}

const decodeErrors = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      errors: Schema.NonEmptyArray(
        Schema.Struct({
          type: Schema.optional(Schema.String),
          message: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
);

export const make = Effect.gen(function* () {
  const rest = yield* GitHubRest.GitHubRest;
  const policy = yield* GitHubRequestPolicy.GitHubRequestPolicy;
  const httpClient = yield* HttpClient.HttpClient;
  const graphql = Effect.fn("GitHubApi.graphql")(function* (input: GitHubGraphQlInput) {
    const host = GitHubRequestPolicy.normalizeHost(input.host);
    return yield* policy.request(
      {
        host,
        operation: input.operation,
        resource: "graphql",
        allowReserve: input.allowReserve ?? (yield* SourceControlRateLimit.Interactive),
      },
      (headers) =>
        Effect.gen(function* () {
          const response = yield* httpClient
            .execute(
              HttpClientRequest.post(GitHubRequestPolicy.gitHubApiUrls(host).graphql).pipe(
                HttpClientRequest.acceptJson,
                HttpClientRequest.setHeaders(headers),
                HttpClientRequest.bodyJsonUnsafe({
                  query: input.query,
                  variables: input.variables ?? {},
                }),
              ),
            )
            .pipe(Effect.provideService(HttpClient.TracerDisabledWhen, () => true));
          const body = yield* collectUint8StreamText({
            stream: response.stream,
            maxBytes: input.maxResponseBytes ?? 8 * 1024 * 1024,
          }).pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "EmptyBodyError",
              () => Effect.succeed({ text: "", truncated: false }),
            ),
          );
          const meta = { status: response.status, headers: response.headers };
          if (body.truncated) return { _tag: "Failed", ...meta } as const;
          const errors = Option.getOrUndefined(decodeErrors(body.text))?.errors;
          if (
            GitHubRequestPolicy.isRateLimited({
              ...meta,
              body: body.text,
              ...(errors === undefined ? {} : { graphqlErrors: errors }),
            })
          ) {
            return { _tag: "RateLimited", ...meta } as const;
          }
          if (response.status === 401) return { _tag: "Unauthorized", ...meta } as const;
          if (response.status === 404 || errors?.every((error) => error.type === "NOT_FOUND")) {
            return { _tag: "NotFound", ...meta } as const;
          }
          if (errors !== undefined || response.status < 200 || response.status >= 300) {
            return {
              _tag: "Failed",
              messages: errors?.flatMap((error) =>
                error.message === undefined ? [] : [error.message],
              ),
              ...meta,
            } as const;
          }
          return { _tag: "Ok", value: body.text, ...meta } as const;
        }).pipe(
          Effect.mapError(
            (cause) =>
              new GitHubRequestPolicy.GitHubApiRequestError({
                host,
                operation: input.operation,
                cause,
              }),
          ),
        ),
    );
  });
  return GitHubApi.of({ ...rest, graphql });
});

export const layer = Layer.effect(GitHubApi, make);
