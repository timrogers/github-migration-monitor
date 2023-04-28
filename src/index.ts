#!/usr/bin/env node

import { program } from 'commander';
import { Octokit } from "@octokit/core";
import { paginateGraphql } from "@octokit/plugin-paginate-graphql";
import groupBy from 'lodash.groupby';
import fetch from 'cross-fetch';

import { description, name, version } from './../package.json';
import logger from './logger';
import { RepositoryMigration } from './types';
import { presentState } from './utils';

program
  .name(name)
  .description(description)
  .version(version)
  .option('--github-token <token>', 'A GitHub personal access token (PAT) with `read:org` scope. Required to be set using this option or the `GITHUB_TOKEN` environment variable.')
  .requiredOption('--organization <organization>', 'The GitHub organization to monitor')
  .option('--interval-in-seconds <interval_in_seconds>', 'Interval in seconds between refreshes', (value) => parseInt(value), 10);

program.parse();

const opts = program.opts();

const githubToken = opts.githubToken || process.env.GITHUB_TOKEN;

if (!githubToken) {
  logger.error('GitHub token is required. Please set it using the `--github-token` option or the `GITHUB_TOKEN` environment variable.');
  process.exit(1);
}

const OctokitWithPaginateGraphql = Octokit.plugin(paginateGraphql);

const octokit = new OctokitWithPaginateGraphql({ auth: githubToken });

const getRepositoryMigrations = async (organizationId: string): Promise<RepositoryMigration[]> => {
  const paginatedResponse = await octokit.graphql.paginate(
    `
      query paginateRepositoryMigrations($cursor: String) {
        node(id: ${JSON.stringify(organizationId)}) {
          ... on Organization {
            repositoryMigrations(after: $cursor, first: 100) {
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

  return paginatedResponse.node.repositoryMigrations.nodes as RepositoryMigration[];
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

async function getMigrationLogEntries(migrationId: string, currentAttempt = 1): Promise<string[]> {
  const migrationLogUrl = await fetchMigrationLogUrl(migrationId);

  if (migrationLogUrl) {
    const migrationLogResponse = await fetch(migrationLogUrl);
    
    if (migrationLogResponse.ok) {
      const migrationLog = await migrationLogResponse.text();
      return migrationLog.split('\n');
    } else {
      throw `Unable to get migration log for migration ${migrationId}: ${migrationLogResponse.status} ${migrationLogResponse.statusText}`;
    }
  } else {
    if (currentAttempt < MAXIMUM_ATTEMPTS_TO_GET_MIGRATION_LOG) {
      return getMigrationLogEntries(migrationId, currentAttempt + 1);
    } else {
      throw `Unable to get migration log URL for migration ${migrationId} after ${MAXIMUM_ATTEMPTS_TO_GET_MIGRATION_LOG} attempt(s)`;
    }
  }
}

const logFailedMigration = (migration: RepositoryMigration): void => { logger.error(`🛑 Migration of ${migration.repositoryName} (${migration.id}) failed: ${migration.failureReason}`) };
const logSuccessfulMigration = (migration: RepositoryMigration): void => { logger.info(`✅ Migration of ${migration.repositoryName} (${migration.id}) succeeded`) };

const logMigrationWarnings = async (migration: RepositoryMigration): Promise<void> => {
  const migrationLogEntries = await getMigrationLogEntries(migration.id);
  
  const migrationLogWarnings = migrationLogEntries.filter((entry) => entry.includes('WARN'));

  for (const migrationLogWarning of migrationLogWarnings) {
    const presentedWarning = migrationLogWarning.split(' -- ')[1];
    logger.warn(`⚠️  Migration of ${migration.repositoryName} (${migration.id}) returned a warning: ${presentedWarning}`);
  }
}

(async () => {
  let repositoryMigrations = [] as RepositoryMigration[];

  const organizationId = await getOrganizationId(opts.organization);

  async function updateRepositoryMigration(isFirstRun: boolean) {
    const currentRepositoryMigrations = await getRepositoryMigrations(organizationId);

    const countsByState = Object.fromEntries(
      Object
        .entries(groupBy(currentRepositoryMigrations, (migration) => presentState(migration.state)))
        .map(([state, migrations]) => [state.toString().toLowerCase(), migrations.length])
    );

    const countsAsString = Object.entries(countsByState).map(([state, count]) => `${count} ${state}`).join(', ');
    logger.info(`📊 Current stats: ${countsAsString}`);

    for (const existingMigration of repositoryMigrations) {
      const updatedMigration = currentRepositoryMigrations.find((currentMigration) => currentMigration.id === existingMigration.id);

      if (updatedMigration) {
        if (updatedMigration.state !== existingMigration.state) {
          if (updatedMigration.state === 'FAILED') {
            logFailedMigration(updatedMigration);
          } else if (updatedMigration.state === 'SUCCEEDED') {
            logSuccessfulMigration(updatedMigration);
            logMigrationWarnings(updatedMigration);
          } else {
            logger.info(`↗️  Migration of ${existingMigration.repositoryName} (${updatedMigration.id}) changed state: ${presentState(existingMigration.state)} ➡️  ${presentState(updatedMigration.state)}`);
          }
        }
      }
    }

    if (!isFirstRun) {
      const newMigrations = currentRepositoryMigrations.filter((currentMigration) => !repositoryMigrations.find((existingMigration) => existingMigration.id === currentMigration.id));

      for (const newMigration of newMigrations) {
        if (newMigration.state === 'FAILED') {
          logFailedMigration(newMigration);
        } else if (newMigration.state === 'SUCCEEDED') {
          logSuccessfulMigration(newMigration);
          logMigrationWarnings(newMigration);
        } else if (newMigration.state === 'QUEUED') {
          logger.info(`↗️  Migration of ${newMigration.repositoryName} (${newMigration.id}) was queued`);
        } else {
          logger.info(`↗️  Migration of ${newMigration.repositoryName} (${newMigration.id}) was queued and is currently ${presentState(newMigration.state)}`);
        }
      }
    }

    repositoryMigrations = currentRepositoryMigrations;

    setTimeout(() => updateRepositoryMigration(false), opts.intervalInSeconds * 1000);
  }    

  updateRepositoryMigration(true);
})();