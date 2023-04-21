# Contributing

## Development

To make changes, edit the TypeScript files in `src/`.

While you're making changes locally, you can test your changes without compiling manually each time using `npm run dev` - for example `npm run dev -- --organization acme-corp`.

## Linting

Code style and formatting are enforced using [ESLint](https://eslint.org/) and [Prettier](https://prettier.io/).

You can lint your code by running `npm run lint`, and automatically fix many issues by running `npm run lint-and-fix`.

Code is automatically linted on push, and PRs will not be able to merge merged until all checks pass.

## Releasing a new version

This project uses [`semantic-release`](https://github.com/semantic-release/semantic-release) to automatically cut a release and push the update to [npm](https://npmjs.com) whenever changes are merged to `main`.

As part of the release process, the TypeScirpt will be compiled.

Commit messages starting with `feat:` will trigger a minor version, and `fix:` will trigger a patch version. If the commit message contains `BREAKING CHANGE:`, a major version will be released.
