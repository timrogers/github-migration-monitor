#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const core_1 = require("@octokit/core");
const plugin_paginate_graphql_1 = require("@octokit/plugin-paginate-graphql");
const lodash_groupby_1 = __importDefault(require("lodash.groupby"));
const package_json_1 = require("./../package.json");
const logger_1 = __importDefault(require("./logger"));
const utils_1 = require("./utils");
commander_1.program
    .name(package_json_1.name)
    .description(package_json_1.description)
    .version(package_json_1.version)
    .option('--github-token <token>', 'A GitHub personal access token (PAT) with `read:org` scope. Required to be set using this option or the `GITHUB_TOKEN` environment variable.')
    .requiredOption('--organization <organization>', 'The GitHub organization to monitor')
    .option('--interval <interval>', 'Interval in seconds between refreshes', (value) => parseInt(value), 10);
commander_1.program.parse();
const opts = commander_1.program.opts();
const githubToken = opts.githubToken || process.env.GITHUB_TOKEN;
if (!githubToken) {
    logger_1.default.error('GitHub token is required. Please set it using the `--github-token` option or the `GITHUB_TOKEN` environment variable.');
    process.exit(1);
}
const OctokitWithPaginateGraphql = core_1.Octokit.plugin(plugin_paginate_graphql_1.paginateGraphql);
const octokit = new OctokitWithPaginateGraphql({ auth: githubToken });
const getRepositoryMigrations = async (organizationId) => {
    const paginatedResponse = await octokit.graphql.paginate(`
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
      }  `);
    return paginatedResponse.node.repositoryMigrations.nodes;
};
const getOrganizationId = async (organizationLogin) => {
    const response = await octokit.graphql(`
    query getOrganizationId($organizationLogin: String!) {
      organization(login: $organizationLogin) {
        id
      }
    }
  `, {
        organizationLogin
    });
    return response.organization.id;
};
const logFailedMigration = (migration) => { logger_1.default.error(`🛑 Migration of ${migration.repositoryName} (${migration.id}) failed: ${migration.failureReason}`); };
const logSuccessfulMigration = (migration) => { logger_1.default.info(`✅ Migration of ${migration.repositoryName} (${migration.id}) succeeded`); };
(async () => {
    let repositoryMigrations = [];
    const organizationId = await getOrganizationId(opts.organization);
    async function updateRepositoryMigration(isFirstRun) {
        const currentRepositoryMigrations = await getRepositoryMigrations(organizationId);
        const countsByState = Object.fromEntries(Object
            .entries((0, lodash_groupby_1.default)(currentRepositoryMigrations, (migration) => (0, utils_1.presentState)(migration.state)))
            .map(([state, migrations]) => [state.toString().toLowerCase(), migrations.length]));
        const countsAsString = Object.entries(countsByState).map(([state, count]) => `${count} ${state}`).join(', ');
        logger_1.default.info(`📊 Current stats: ${countsAsString}`);
        for (const existingMigration of repositoryMigrations) {
            const updatedMigration = currentRepositoryMigrations.find((currentMigration) => currentMigration.id === existingMigration.id);
            if (updatedMigration) {
                if (updatedMigration.state !== existingMigration.state) {
                    if (updatedMigration.state === 'FAILED') {
                        logFailedMigration(updatedMigration);
                    }
                    else if (updatedMigration.state === 'SUCCEEDED') {
                        logSuccessfulMigration(updatedMigration);
                    }
                    else {
                        logger_1.default.info(`↗️  Migration of ${existingMigration.repositoryName} (${updatedMigration.id}) changed state: ${(0, utils_1.presentState)(existingMigration.state)} ➡️  ${(0, utils_1.presentState)(updatedMigration.state)}`);
                    }
                }
            }
        }
        if (!isFirstRun) {
            const newMigrations = currentRepositoryMigrations.filter((currentMigration) => !repositoryMigrations.find((existingMigration) => existingMigration.id === currentMigration.id));
            for (const newMigration of newMigrations) {
                if (newMigration.state === 'FAILED') {
                    logFailedMigration(newMigration);
                }
                else if (newMigration.state === 'SUCCEEDED') {
                    logSuccessfulMigration(newMigration);
                }
                else if (newMigration.state === 'QUEUED') {
                    logger_1.default.info(`↗️  Migration of ${newMigration.repositoryName} (${newMigration.id}) was queued`);
                }
                else {
                    logger_1.default.info(`↗️  Migration of ${newMigration.repositoryName} (${newMigration.id}) was queued and is currently ${(0, utils_1.presentState)(newMigration.state)}`);
                }
            }
        }
        repositoryMigrations = currentRepositoryMigrations;
        setTimeout(() => updateRepositoryMigration(false), opts.interval * 1000);
    }
    updateRepositoryMigration(true);
})();
