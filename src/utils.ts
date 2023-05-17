import { RequestError } from "@octokit/request-error";
import { GraphqlResponseError } from "@octokit/graphql";

export const presentState = (state: string): string => state.replace('_', ' ').toLowerCase();

export const serializeError = (e: unknown): string => {
  if (typeof e === 'string') return e;
  if (e instanceof RequestError) return e.message;
  if (e instanceof GraphqlResponseError) return e.message;
  return JSON.stringify(e);
}