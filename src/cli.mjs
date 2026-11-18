import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { getFiles, getPullRequest, isPrUrl, setViewed } from "./github.mjs";
import { PRESETS, createFilter } from "./matcher.mjs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const isColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code) => (text) => (isColor ? `\x1b[${code}m${text}\x1b[0m` : text);

const color = { dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33) };

const MARK = { targetState: "VIEWED", verb: "viewed" };

const UNMARK = { targetState: "UNVIEWED", verb: "unviewed" };

const HELP = `gh-viewed ${version}
Mark files in a GitHub pull request as viewed, picked by glob, folder, extension, or preset.

Usage
  gh viewed [pr] <pattern...> [options]

  pr    PR number or URL. Omitted: the open PR for the current branch.

Patterns (a file is changed when it matches any include and no exclude)
  tests                 preset: ${Object.keys(PRESETS).join(", ")}
  json, .json           extension (or exact file name, e.g. Makefile)
  src/components        folder and everything under it, or one exact file
  'src/**/*.ts'         glob; a glob without "/" matches the file name at any depth
  '!src/legacy/'        exclude; takes any form above

Options
  -u, --unmark          mark as not viewed instead
  -n, --dry-run         list matching files, change nothing
  -R, --repo <owner/repo>  repo of the PR (default: current repo, or its upstream for a fork)
  -h, --help            show this help
  -v, --version         show version

Quote globs and "!" patterns so your shell passes them through unexpanded.`;

const OPTIONS = {
    "repo": { type: "string", short: "R" },
    "help": { type: "boolean", short: "h" },
    "unmark": { type: "boolean", short: "u" },
    "dry-run": { type: "boolean", short: "n" },
    "version": { type: "boolean", short: "v" },
};

const isPrSelector = (value) => /^\d+$/.test(value) || isPrUrl(value);

const parseCli = () => {
    const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true, strict: true });
    const { unmark, "dry-run": dryRun, repo, help, version: showVersion } = values;
    const hasSelector = positionals.length > 0 && isPrSelector(positionals[0]);

    return {
        repo,
        isHelp: Boolean(help),
        isUnmark: Boolean(unmark),
        isDryRun: Boolean(dryRun),
        isVersion: Boolean(showVersion),
        selector: hasSelector ? positionals[0] : undefined,
        patterns: hasSelector ? positionals.slice(1) : positionals,
    };
};

const printPaths = (mark, verb) => (paths) => paths.forEach((path) => console.log(`${mark} ${verb} ${path}`));

const printFailures = (failures) => {
    failures.forEach(({ paths, error }) => {
        paths.forEach((path) => console.error(`${color.red("✗")} ${path}`));
        console.error(color.red(error.message));
    });
};

const run = async () => {
    const { isUnmark, isDryRun, isHelp, isVersion, repo, selector, patterns } = parseCli();
    if (isVersion) {
        console.log(version);
        return;
    }

    if (isHelp || patterns.length === 0) {
        console.log(HELP);
        process.exitCode = isHelp ? 0 : 1;
        return;
    }

    const isMatch = createFilter(patterns);
    const { targetState, verb } = isUnmark ? UNMARK : MARK;
    const needsChange = ({ viewerViewedState }) => viewerViewedState !== targetState;

    const pullRequest = await getPullRequest({ selector, repo });
    const files = await getFiles(pullRequest);
    const matched = files.filter(({ path }) => isMatch(path));
    const pending = matched.filter(needsChange).map(({ path }) => path);

    const { owner, repo: name, number, id } = pullRequest;
    const summary = `${owner}/${name}#${number}: ${files.length} files, ${matched.length} matched, ${pending.length} to change`;
    console.log(color.dim(summary));

    if (isDryRun) {
        printPaths(color.yellow("[dry-run]"), verb)(pending);
        return;
    }

    const onDone = printPaths(color.green("✓"), verb);
    const failures = await setViewed({ pullRequestId: id, paths: pending, isUnmark, onDone });
    if (failures.length > 0) {
        printFailures(failures);
        process.exitCode = 1;
    }
};

run().catch((error) => {
    console.error(color.red(error.message));
    process.exitCode = 1;
});
