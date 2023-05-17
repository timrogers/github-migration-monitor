# GitHub Migration Monitor

This command line tool allows you to monitor an organization's [GitHub Enterprise Importer (GEI)](https://docs.github.com/en/migrations/using-github-enterprise-importer) migrations.

It'll watch your organization's migrations and display a UI with your queued, in progress, successful and failed migrations, plus an event log.

## Usage

1. Make sure you have [Node.js](https://nodejs.org/) installed. You can double check by running `node --version`.
2. Make sure you have [npm](https://npmjs.com) installed. You can double check by running `npm --version`.
3. Set the `GITHUB_TOKEN` environment variable to a classic personal access token (PAT) with the `admin:org` scope.
4. Run `npx github-migration-monitor --organization ORGANIZATION`, replacing `ORGANIZATION` with your organization name.

### Customizing how often the CLI polls for updates

By default, the CLI will poll for updates to your migrations every 10 seconds.

You can customize this by setting the `--interval-in-seconds` argument with a value in seconds.

### Setting the GitHub token using a command line argument

Instead of specifying your access token using the `GITHUB_TOKEN` environment variable, you can alternatively use the `--github-token` argument
