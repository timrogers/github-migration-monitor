# GitHub Migration Monitor

This command line tool allows you to monitor an organization's [GitHub Enterprise Importer (GEI)](https://docs.github.com/en/migrations/using-github-enterprise-importer) migrations.

It'll watch your organization's migrations and provide you updates as new migrations are queued and as they progress, including outputting warnings from successful migrations.

```
2023-04-21T12:57:04.689Z info: 📊 Current stats: 3 succeeded, 1 failed
2023-04-21T12:57:15.337Z info: 📊 Current stats: 3 succeeded, 1 failed, 1 queued
2023-04-21T12:57:15.337Z info: ↗️ Migration of my-repo (RM_kgDaACQzY2Q5YjRjYi0xMmQ0LTRiYjQtYjBmZC0zZGIzYWM5M2Q2YzU) was queued
2023-04-21T12:57:25.987Z info: 📊 Current stats: 3 succeeded, 1 failed, 1 in progress
2023-04-21T12:57:25.987Z info: ↗️  Migration of my-repo (RM_kgDaACQzY2Q5YjRjYi0xMmQ0LTRiYjQtYjBmZC0zZGIzYWM5M2Q2YzU) changed state: queued ➡️ in progress
2023-04-21T12:57:36.740Z info: 📊 Current stats: 3 succeeded, 1 failed, 1 in progress
2023-04-21T12:57:47.374Z info: 📊 Current stats: 3 succeeded, 1 failed, 1 in progress
2023-04-21T12:57:58.072Z info: 📊 Current stats: 3 succeeded, 1 failed, 1 in progress
2023-04-21T12:58:08.821Z info: 📊 Current stats: 3 succeeded, 1 failed, 1 in progress
2023-04-21T12:58:19.545Z info: 📊 Current stats: 3 succeeded, 1 failed, 1 in progress
2023-04-21T12:58:30.191Z info: 📊 Current stats: 4 succeeded, 1 failed
2023-04-21T12:58:30.191Z info: ✅ Migration of my-repo (RM_kgDaACQzY2Q5YjRjYi0xMmQ0LTRiYjQtYjBmZC0zZGIzYWM5M2Q2YzU) succeeded
2023-04-21T12:58:31.191Z warn: ⚠️  Migration of my-repo(RM_kgDaACQzY2Q5YjRjYi0xMmQ0LTRiYjQtYjBmZC0zZGIzYWM5M2Q2YzU) returned a warning: Pull Request Review Thread Comment with url https://github.com/monalisa/my-repo/pull/277/files#r93784193 could not be transformed. Reason: Document::ValidationError - {:thread_id=>["can't be blank"]}
```

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
