import { RequestError } from "@octokit/request-error";
import { GraphqlResponseError } from "@octokit/graphql";

export const presentState = (state: string): string => state.replace('_', ' ').toLowerCase();

export const serializeError = (e: unknown): string => {
  if (typeof e === 'string') return e;
  if (e instanceof RequestError) return e.message;
  if (e instanceof GraphqlResponseError) return e.message;
  return JSON.stringify(e);
}

export const getRequestIdFromError = (e: unknown): string | undefined => {
  if (e instanceof GraphqlResponseError) return e.headers["x-github-request-id"];
  if (e instanceof RequestError) return e.response?.headers["x-github-request-id"];
  return undefined;
};

const isValidDate = (date: unknown): boolean => date instanceof Date && !isNaN(date.getTime());

export const parseSince = (since: string): Date => {
  if (since === 'now') {
    return new Date();
  } else if (since.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Passing a date without time will default to midnight UTC, when we want to use
    // local time if a specific time zone is not specified
    return new Date(`${since}T00:00:00`);
  } else {
    const dateFromInput = new Date(since);

    if (isValidDate(dateFromInput)) {
      return new Date(since);
    } else {
      throw 'The provided date seems to be invalid. Please provide a valid ISO 8601 date or datetime, or use "now" to use the current date.';
    }
  }
};