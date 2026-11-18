# gh-viewed

Mark files in a GitHub pull request as **Viewed** from the command line, picked by glob, folder, extension, or a named preset like `tests`.

Large PRs often carry files you don't need to read line by line: lockfiles, snapshots, generated types, or a test suite you'll skim later. Ticking the "Viewed" box on each one in the browser is slow. `gh-viewed` does it in one command, and the GitHub UI then collapses those files so you can focus on the rest.

```sh
gh viewed tests locks              # every test file and lockfile in the current branch's PR
gh viewed 1234 'src/components/**/*.tsx'
gh viewed json '!package.json'     # all .json files except package.json
gh viewed --unmark docs            # flip docs back to not viewed
```

## Install

Requires [GitHub CLI](https://cli.github.com), logged in with `gh auth login`, and Node.js 18.18 or newer. No npm dependencies.

**As a `gh` extension** (run as `gh viewed`):

```sh
gh extension install rushi/gh-viewed
gh extension upgrade gh-viewed     # later, to update
```

**From npm** (run as `gh-viewed`):

```sh
npm install --global gh-viewed
# or once, without installing
npx gh-viewed tests
```

## Usage

```
gh viewed [pr] <pattern...> [options]
```

`pr` is a PR number or URL, in any position (`gh viewed tests 1234` works). GitHub Enterprise Server URLs work too, given a `gh auth login --hostname` for that host.

Leave `pr` out to use the open PR for the current branch. In a fork, the PR is looked up on the upstream repo. Only a PR whose branch lives in the base repo or in your own fork counts, so a branch named `main` or `patch-1` never picks up a stranger's PR. On a detached HEAD, pass the PR explicitly.

| Option                     | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `-n`, `--dry-run`          | List the files that would change, change nothing          |
| `-u`, `--unmark`           | Mark as not viewed instead                                |
| `-R`, `--repo owner/repo`  | Repo of the PR, when not the current one                  |
| `-h`, `--help`             | Show help                                                 |
| `-v`, `--version`          | Show version                                              |

Files already in the requested state are skipped, so running the same command twice is safe.

## Patterns

Pass any number of patterns. A file changes when it matches at least one include and no exclude. Each pattern is read as the first form below that fits, except that a trailing `/` or leading `./` always means a path.

| Form       | Example                                  | Matches                                                                 |
| ---------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| Preset     | `tests`                                  | A named group of files, see below. Case-insensitive.                    |
| Glob       | `'src/**/*.ts'`, `'*.{yml,yaml}'`        | Globs with a `/` match from the repo root. Without one, they match the file name at any depth; `'./*.json'` limits to the root. |
| Path       | `src/components`, `src/components/`, `./ci` | That folder and everything under it, or that exact file. `ci/` and `./ci` mean the `ci` folder, not the preset. |
| Extension  | `json`, `.json`                          | Files ending in `.json`, case-insensitive. A bare word also matches a file with that exact name, such as `Makefile`. |
| Exclude    | `'!src/legacy/'`, `'!*.snap'`, `'!tests'` | A `!` prefix on any form above removes matches.                        |

With only excludes, every other file in the PR matches. `gh viewed '!src/**'` marks every file outside `src/`.

Glob syntax: `*` (within one folder), `**` (any depth), `?`, `[abc]`, `[!abc]`, `{a,b}`.

> Quote globs and `!` patterns. Otherwise your shell expands `*` against local files, and zsh or bash may treat `!` as history expansion.

### Presets

| Preset      | Matches                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `tests`     | `*.test.*` / `*.spec.*` JS and TS files, `__tests__/`, `test/`, `tests/`, `spec/`, Go `*_test.go`, Python `test_*.py` and `*_test.py`, Ruby `*_spec.rb`, PHP `*Test.php` |
| `snapshots` | `__snapshots__/`, `*.snap`                                                                        |
| `stories`   | `*.stories.{js,jsx,ts,tsx,mdx}`                                                                   |
| `mocks`     | `__mocks__/`, `mock/`, `mocks/`                                                                   |
| `fixtures`  | `__fixtures__/`, `fixtures/`                                                                      |
| `locks`     | npm, Yarn, pnpm, Bun, Composer, Bundler, Cargo, Poetry, uv lockfiles and `go.sum`                 |
| `types`     | `*.d.ts`, `*.d.mts`, `*.d.cts`                                                                    |
| `docs`      | `*.md`, `*.mdx`, `*.rst`, `*.txt`, `doc/`, `docs/`                                                 |
| `ci`        | `.github/`, `.circleci/`, `.gitlab/`, `.gitlab-ci.yml`, `Jenkinsfile`                             |

Missing an ecosystem? PRs welcome, see [`src/matcher.mjs`](src/matcher.mjs).

## How it works

`gh-viewed` calls the GitHub GraphQL API through your `gh` login. It reads the PR's file list along with your viewed state for each file, filters it locally, then sends `markFileAsViewed` (or `unmarkFileAsViewed`) mutations in batches of 25 per request. Viewed state is per user, so nobody else's review is affected.

## Development

```sh
git clone https://github.com/rushi/gh-viewed && cd gh-viewed
npm test                                  # node:test, no install step
./gh-viewed <pr-url> tests --dry-run      # try it against any PR you can read
gh extension install .                    # run your checkout as `gh viewed`
```

## License

[MIT](LICENSE)
