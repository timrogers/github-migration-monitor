#!/usr/bin/env node

import { program } from 'commander';
import { Octokit } from "@octokit/core";
import { paginateGraphql } from "@octokit/plugin-paginate-graphql";
import groupBy from 'lodash.groupby';
import fetch from 'cross-fetch';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en'

TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo('en');

import logger from './logger';
import { MigrationState, Opts, RepositoryMigration } from './types';
import { getRequestIdFromError, parseSince, presentState, serializeError } from './utils';

program
  .name(name)
  .description(description)
  .option('--github-token <token>', 'A GitHub personal access token (PAT) with `read:org` scope. Required to be set using this option or the `GITHUB_TOKEN` environment variable.', process.env.GITHUB_TOKEN)
  .requiredOption('--organization <organization>', 'The GitHub organization to monitor')
  .option('--interval-in-seconds <interval-in-seconds>', 'Interval in seconds between refreshes', (value) => parseInt(value), 10)
  .option('--since <since>', 'Only show migrations created after this date and/or time. If this argument isn\'t set, migrations from the last 7 days will be shown. Supports ISO 8601 dates (e.g. `2023-05-18`) - which are interpreted as 00:00:00 in your machine\'s local time - and ISO 8601 timestamps.');

program.parse();

const opts: Opts = program.opts();

const {
  githubToken,
  intervalInSeconds,
  organization,
} = opts;

if (!githubToken) {
  logger.error('GitHub token is required. Please set it using the `--github-token` option or the `GITHUB_TOKEN` environment variable.');
  process.exit(1);
}

let since: Date | undefined = undefined;

if (opts.since) {
  try {
    since = parseSince(opts.since);
  } catch (e) {
    logger.error(e);
    process.exit(1);
  }
}

const intervalInMilliseconds = intervalInSeconds * 1_000;

const OctokitWithPaginateGraphql = Octokit.plugin(paginateGraphql);

const octokit = new OctokitWithPaginateGraphql({ auth: githubToken });

const getRepositoryMigrations = async (organizationId: string, since: Date | undefined): Promise<RepositoryMigration[]> => {
  // `@octokit/plugin-paginate-graphql` doesn't support GraphQL variables yet, so we have to use string interpolation
  // to add the ID to the query
  const paginatedResponse = await octokit.graphql.paginate(
    `
      query paginateRepositoryMigrations($cursor: String) {
        node(id: ${JSON.stringify(organizationId)}) {
          ... on Organization {
            repositoryMigrations(after: $cursor, first: 10) {
              nodes {
                id
                createdAt
                failureReason
                repositoryName
                state
                migrationLogUrl
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }  `
  );

  const repositoryMigrations = paginatedResponse.node.repositoryMigrations.nodes as RepositoryMigration[];

  if (since) {
    return repositoryMigrations.filter(migration => new Date(migration.createdAt) >= since);
  } else {
    return repositoryMigrations;
  }
};

const getOrganizationId = async (organizationLogin: string): Promise<string> => {
  const response = await octokit.graphql(`
    query getOrganizationId($organizationLogin: String!) {
      organization(login: $organizationLogin) {
        id
      }
    }
  `, {
    organizationLogin
  }) as { organization: { id: string }};

  return response.organization.id;
}

const fetchMigrationLogUrl = async (migrationId: string): Promise<string | null> => {
  const response = await octokit.graphql(`
    query getMigrationLogUrl($migrationId: ID!) {
      node(id: $migrationId) {
        ... on Migration { migrationLogUrl }
      }
    }
  `, {
    migrationId
  }) as { node: { migrationLogUrl: string | null }};

  return response.node.migrationLogUrl;
}

const MAXIMUM_ATTEMPTS_TO_GET_MIGRATION_LOG = 5;

const getMigrationLogEntries = async (migration: RepositoryMigration, currentAttempt = 1): Promise<string[]> => {
  try {
    const migrationLogUrl = await fetchMigrationLogUrl(migration.id);

    if (migrationLogUrl) {
      const migrationLogResponse = await fetch(migrationLogUrl);

      if (migrationLogResponse.ok) {
        const migrationLog = await migrationLogResponse.text();
        return migrationLog.split('\n');
      } else {
        throw `Migration log URL found but fetching it returned ${migrationLogResponse.status} ${migrationLogResponse.statusText}`;
      }
    } else {
      throw 'Migration found but migration log URL not yet available';
    }
  } catch (e) {
    if (currentAttempt < MAXIMUM_ATTEMPTS_TO_GET_MIGRATION_LOG) {
      logWarn(`failed to download migration log after ${currentAttempt} attempts (${serializeError(e)}), trying again...`, migration);
      return getMigrationLogEntries(migration, currentAttempt + 1);
    } else {
     logError(`failed to download migration log after ${MAXIMUM_ATTEMPTS_TO_GET_MIGRATION_LOG} attempt(s): ${serializeError(e)}`, migration);
     return [];
    }
  }
}

const logMigrationWarnings = async (migration: RepositoryMigration): Promise<void> => {
  const migrationLogEntries = await getMigrationLogEntries(migration);
  
  const migrationLogWarnings = migrationLogEntries.filter((entry) => entry.includes('WARN'));

  for (const migrationLogWarning of migrationLogWarnings) {
    const presentedWarning = migrationLogWarning.split(' -- ')[1];
    logWarn(`returned a warning: ${presentedWarning}`, migration);
  }
}

const screen = blessed.screen();

const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

const TOP_ROW_COLUMN_WIDTHS = [40, 30];

const queuedTable = grid.set(0, 0, 7, 4, contrib.table, { label: 'Queued', keys: true, fg: 'white', selectedFg: 'white', selectedBg: null, interactive: true, border: { type: 'line', fg: 'cyan' }, columnSpacing: 5, columnWidth: TOP_ROW_COLUMN_WIDTHS }) as contrib.Widgets.TableElement;

const inProgressTable = grid.set(0, 4, 7, 4, contrib.table, { label: 'In Progress', keys: true, fg: 'white', selectedFg: 'white', selectedBg: 'blue', interactive: true, border: { type: 'line', fg: 'yellow' }, columnSpacing: 5, columnWidth: TOP_ROW_COLUMN_WIDTHS }) as contrib.Widgets.TableElement;

const succeededTable = grid.set(0, 8, 7, 4, contrib.table, { label: 'Succeeded', keys: true, fg: 'white', selectedFg: 'white', selectedBg: 'blue', interactive: true, border: { type: 'line', fg: 'green' }, columnSpacing: 5, columnWidth: TOP_ROW_COLUMN_WIDTHS }) as contrib.Widgets.TableElement;

const failedTable = grid.set(7, 0, 3, 12, contrib.table, { label: 'Failed', keys: false, fg: 'white', border: { type: 'line', bg: 'red' }, columnSpacing: 5, columnWidth: [50, 20, 100] }) as contrib.Widgets.TableElement;

const eventLog = grid.set(10, 0, 2, 12, contrib.log, { fg: 'green', selectedFg: 'green', label: 'Event Log' }) as contrib.Widgets.LogElement;

const UI_ELEMENTS: blessed.Widgets.BoxElement[] = [queuedTable, inProgressTable, succeededTable, failedTable, eventLog];

screen.key(['escape', 'q', 'C-c'], () => {
  process.exit(0); 
});

// Fixes https://github.com/yaronn/blessed-contrib/issues/10
screen.on('resize', function () {
  for (const element of UI_ELEMENTS) {
    element.emit('attach');
  }
});

const logError = (message: string, migration?: RepositoryMigration) => eventLog.log(`${buildLogMessagePrefix('ERROR', migration)} ${message}`);
const logInfo = (message: string, migration?: RepositoryMigration) => eventLog.log(`${buildLogMessagePrefix('INFO', migration)} ${message}`);
const logWarn = (message: string, migration?: RepositoryMigration) => eventLog.log(`${buildLogMessagePrefix('WARN', migration)} ${message}`);

const buildLogMessagePrefix = (level: string, migration: RepositoryMigration | undefined): string => {
  if (migration) {
    return `[${level}] Migration of ${migration.repositoryName} (${migration.id})`;
  } else {
    return `[${level}]`;
  }
}

const logFailedMigration = (migration: RepositoryMigration): void => { logError(`failed: ${migration.failureReason}`, migration) };
const logSuccessfulMigration = (migration: RepositoryMigration): void => { logInfo(`succeeded`, migration) };

const repositoryMigrationToTableEntry = (repositoryMigration: RepositoryMigration, startedAt: Date | undefined): string[] => {
  if (repositoryMigration.state === 'IN_PROGRESS') {
    const duration = startedAt ? `started ${timeAgo.format(startedAt)}` : `queued ${timeAgo.format(new Date(repositoryMigration.createdAt))}`;
    return [repositoryMigration.repositoryName, duration];
  } else {
    return [repositoryMigration.repositoryName, `queued ${timeAgo.format(new Date(repositoryMigration.createdAt))}`];
  }
};

const failedRepositoryMigrationToTableEntry = (repositoryMigration: RepositoryMigration, startedAt: Date | undefined): string[] => repositoryMigrationToTableEntry(repositoryMigration, startedAt).concat(repositoryMigration.failureReason || '');

const TABLE_COLUMNS = ['Repository', 'Duration'];

const updateScreen = (repositoryMigrations: RepositoryMigration[], repositoryMigrationsStartedAt: Map<string, Date>): void => {
  const migrationsByState = groupBy(repositoryMigrations, (migration) => migration.state);
  
  const queuedMigrations = migrationsByState[MigrationState.QUEUED] || [];
  const notStartedMigrations = migrationsByState[MigrationState.NOT_STARTED] || [];
  const pendingValidationMigrations = migrationsByState[MigrationState.PENDING_VALIDATION] || [];

  const failedMigrations = migrationsByState[MigrationState.FAILED] || [];
  const failedValidationMigrations = migrationsByState[MigrationState.FAILED_VALIDATION] || [];

  const queuedMigrationsForTable = queuedMigrations.concat(notStartedMigrations).concat(pendingValidationMigrations);
  const inProgressMigrationsForTable = migrationsByState[MigrationState.IN_PROGRESS] || [];
  const succeededMigrationsForTable = migrationsByState[MigrationState.SUCCEEDED] || [];
  const failedMigrationsForTable = failedMigrations.concat(failedValidationMigrations).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  queuedTable.setData({
    headers: TABLE_COLUMNS,
    data: queuedMigrationsForTable.map(migration => repositoryMigrationToTableEntry(migration, repositoryMigrationsStartedAt.get(migration.id)))
  });

  inProgressTable.setData({
    headers: TABLE_COLUMNS,
    data: inProgressMigrationsForTable.map(migration => repositoryMigrationToTableEntry(migration, repositoryMigrationsStartedAt.get(migration.id)))
  });

  succeededTable.setData({
    headers: TABLE_COLUMNS,
    data: succeededMigrationsForTable.map(migration => repositoryMigrationToTableEntry(migration, repositoryMigrationsStartedAt.get(migration.id)))
  });

  failedTable.setData({
    headers: ['Destination', 'Duration', 'Error'],
    data: failedMigrationsForTable.map(migration => failedRepositoryMigrationToTableEntry(migration, repositoryMigrationsStartedAt.get(migration.id)))
  });

  screen.render();
};

const isMigrationStarted = (migration: RepositoryMigration): boolean => migration.state !== MigrationState.NOT_STARTED && migration.state !== MigrationState.QUEUED;

const getNoMigrationsFoundMessage = (since: Date | undefined): string => {
  if (since) {
    return 'No migrations found since ' + since.toISOString();
  } else {
    return 'No migrations found';
  }
} 

(async () => {
  let repositoryMigrationsState = [] as RepositoryMigration[];

  // The GitHub API doesn't return when a migration started - only when it was queued (`createdAt`).
  // We use this map to keep track of when a migration started so we can show how long it's been running.
  const repositoryMigrationStartedAt = new Map<string, Date>();

  const organizationId = await getOrganizationId(organization);

  async function updateRepositoryMigration(isFirstRun: boolean): Promise<void> {
    let latestRepositoryMigrations: RepositoryMigration[] = [];

    const startedUpdatingAt = new Date();

    try {
      logInfo('Loading migrations...');
      latestRepositoryMigrations = await getRepositoryMigrations(organizationId, since);
    } catch (e) {
      const runtimeInMilliseconds = new Date().getTime() - startedUpdatingAt.getTime();
      const requestId = getRequestIdFromError(e);
      logError(`Failed to load migrations after ${runtimeInMilliseconds}ms (${requestId ?? '-'}): "${serializeError(e)}". Trying again in ${opts.intervalInSeconds} second(s)`);
      
      // If we failed to fetch the migrations and it's currently the first run, we still pretend it's the first run next time
      setTimeout(() => updateRepositoryMigration(isFirstRun), intervalInMilliseconds);
      return;
    }

    logInfo(`Loaded ${latestRepositoryMigrations.length} migration(s) in ${new Date().getTime() - startedUpdatingAt.getTime()}ms`);

    const countsByState = Object.fromEntries(
      Object
        .entries(groupBy(latestRepositoryMigrations, (migration) => presentState(migration.state)))
        .map(([state, migrations]) => [state.toString().toLowerCase(), migrations.length])
    );

    const countsAsString = Object.entries(countsByState).map(([state, count]) => `${count} ${state}`).join(', ');
    logInfo(`Current stats: ${countsAsString || getNoMigrationsFoundMessage(since)}`);

    if (!isFirstRun) {
      // Log for any state changes
      for (const alreadyKnownMigration of repositoryMigrationsState) {
        const latestVersionOfAlreadyKnownMigration = latestRepositoryMigrations.find((migration) => migration.id === alreadyKnownMigration.id);

        // If we've seen this migration before, and it's recorded in our state...
        if (latestVersionOfAlreadyKnownMigration) {
          const stateChanged = latestVersionOfAlreadyKnownMigration.state !== alreadyKnownMigration.state;

          // Record (roughly) when the migration started if it has started since our last check
          if (stateChanged && !repositoryMigrationStartedAt.has(latestVersionOfAlreadyKnownMigration.id) && isMigrationStarted(latestVersionOfAlreadyKnownMigration)) {
            repositoryMigrationStartedAt.set(latestVersionOfAlreadyKnownMigration.id, new Date());
          }

          // Log state changes to the log
          if (latestVersionOfAlreadyKnownMigration.state !== alreadyKnownMigration.state) {
            if (latestVersionOfAlreadyKnownMigration.state === 'FAILED') {
              logFailedMigration(latestVersionOfAlreadyKnownMigration);
            } else if (latestVersionOfAlreadyKnownMigration.state === 'SUCCEEDED') {
              logSuccessfulMigration(latestVersionOfAlreadyKnownMigration);
              logMigrationWarnings(latestVersionOfAlreadyKnownMigration);
            } else {
              logInfo(`changed state: ${presentState(alreadyKnownMigration.state)} ➡️  ${presentState(latestVersionOfAlreadyKnownMigration.state)}`, latestVersionOfAlreadyKnownMigration);
            }
          }
        }
      }

      // Log for new migrations
      const newMigrations = latestRepositoryMigrations.filter((currentMigration) => !repositoryMigrationsState.find((existingMigration) => existingMigration.id === currentMigration.id));

      for (const newMigration of newMigrations) {
        // Record (roughly) when the migration started because it is new and has started
        if (!repositoryMigrationStartedAt.has(newMigration.id) && isMigrationStarted(newMigration)) {
          repositoryMigrationStartedAt.set(newMigration.id, new Date());
        }

        if (newMigration.state === 'FAILED') {
          logFailedMigration(newMigration);
        } else if (newMigration.state === 'SUCCEEDED') {
          logSuccessfulMigration(newMigration);
          logMigrationWarnings(newMigration);
        } else if (newMigration.state === 'QUEUED') {
          logInfo(`was queued`, newMigration);
        } else {
          logInfo(`was queued and is currently ${presentState(newMigration.state)}`, newMigration);
        }
      }
    }

    // Update the state and render the UI
    repositoryMigrationsState = latestRepositoryMigrations;
    updateScreen(repositoryMigrationsState, repositoryMigrationStartedAt);

    /// Start all over again - but it definitely isn't the first run this time
    setTimeout(() => updateRepositoryMigration(false), intervalInMilliseconds);
  } 
  
  // Start the first run, grabbing data and rendering the UI
  updateRepositoryMigration(true);
})();

screen.render();