import { program } from 'commander';
import { Octokit } from "@octokit/core";
import { paginateGraphql } from "@octokit/plugin-paginate-graphql";
import winston from 'winston';
const { combine, timestamp, printf, colorize } = winston.format;
import groupBy from 'lodash.groupby';

import { description, name, version } from './../package.json';

program
  .name(name)
  .description(description)
  .version(version)
  .option('--github-token <token>', 'A GitHub personal access token (PAT) with `read:org` scope. Required to be set using this option or the `GITHUB_TOKEN` environment variable.')
  .requiredOption('--organization <organization>', 'The GitHub organization to monitor')
  .option('--interval <interval>', 'Interval in seconds between refreshes', (value) => parseInt(value), 10);

const customFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

const logger = winston.createLogger({
  format: combine(
    colorize(),
    timestamp(),
    customFormat
    ),
    transports: [
      new winston.transports.Console()
    ] 
  });

program.parse();

const opts = program.opts();

const githubToken = opts.githubToken || process.env.GITHUB_TOKEN;

if (!githubToken) {
  logger.error('GitHub token is required. Please set it using the `--github-token` option or the `GITHUB_TOKEN` environment variable.');
  process.exit(1);
}

const OctokitWithPaginateGraphql = Octokit.plugin(paginateGraphql);

const octokit = new OctokitWithPaginateGraphql({ auth: githubToken });

interface RepositoryMigration {
  id: string;
  createdAt: string;
  failureReason?: string;
  repositoryName: string;
  state: string;
}

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

const logFailedMigration = (migration: RepositoryMigration): void => { logger.error(`🛑 Migration of ${migration.repositoryName} (${migration.id}) failed: ${migration.failureReason}`) };
const logSuccessfulMigration = (migration: RepositoryMigration): void => { logger.info(`✅ Migration of ${migration.repositoryName} (${migration.id}) succeeded`) };

(async () => {
  let repositoryMigrations = [] as RepositoryMigration[];

  const organizationId = await getOrganizationId(opts.organization);

  async function updateRepositoryMigration(isFirstRun: boolean) {
    const currentRepositoryMigrations = await getRepositoryMigrations(organizationId);

    const countsByState = Object.fromEntries(
      Object
        .entries(groupBy(currentRepositoryMigrations, (migration) => migration.state))
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
          } else {
            logger.info(`↗️ Migration of ${existingMigration.repositoryName} (${updatedMigration.id}) changed state: ${existingMigration.state} ➡️ ${updatedMigration.state}`);
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
        } else {
          logger.info(`↗️ Migration of ${newMigration.repositoryName} (${newMigration.id}) was queued and is currently ${newMigration.state}`);
        }
      }
    }

    repositoryMigrations = currentRepositoryMigrations;

    setTimeout(() => updateRepositoryMigration(false), opts.interval * 1000);
  }    

  updateRepositoryMigration(true);
})();