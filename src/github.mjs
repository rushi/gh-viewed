import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Aliased mutations per GraphQL request; keeps each request small while cutting round trips */
const MUTATION_BATCH_SIZE = 25;

const PR_FIELDS = "id,number,url";

const FILES_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      files(first: 100, after: $endCursor) {
        nodes { path viewerViewedState }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export const isPrUrl = (value) => value.includes("github.com/");

const exec = async (command, args) => {
    try {
        const { stdout } = await execFileAsync(command, args, { maxBuffer: 64 * 1024 * 1024 });
        return stdout.trim();
    } catch (error) {
        const isMissing = error.code === "ENOENT";
        const detail = (error.stderr || error.message).trim();
        throw new Error(isMissing ? `\`${command}\` not found on PATH` : detail);
    }
};

const gh = (args) => exec("gh", args);

const ghJson = async (args) => JSON.parse(await gh(args));

/** PRs live on the upstream repo, so a fork resolves to its parent */
const getDefaultRepo = async () => {
    const { nameWithOwner, parent } = await ghJson(["repo", "view", "--json", "nameWithOwner,parent"]);
    return parent ? `${parent.owner.login}/${parent.name}` : nameWithOwner;
};

/** `gh pr list --head` matches the branch name from any fork, unlike `gh pr view <branch>` */
const getBranchPr = async (repo) => {
    const branch = await exec("git", ["branch", "--show-current"]);
    const args = ["pr", "list", "-R", repo, "--head", branch, "--state", "open", "--limit", "1", "--json", PR_FIELDS];
    const [pullRequest] = await ghJson(args);
    if (!pullRequest) {
        throw new Error(`No open PR in ${repo} for branch "${branch}"`);
    }

    return pullRequest;
};

const getSelectedPr = async (selector, repo) => {
    const repoArgs = repo ? ["-R", repo] : [];
    return ghJson(["pr", "view", selector, ...repoArgs, "--json", PR_FIELDS]);
};

/** A URL carries its own repo; otherwise `repo` wins, then the current checkout (or its fork parent) */
export const getPullRequest = async ({ selector, repo }) => {
    const isUrl = Boolean(selector) && isPrUrl(selector);
    const resolvedRepo = isUrl ? undefined : (repo ?? (await getDefaultRepo()));
    const { id, number, url } = selector ? await getSelectedPr(selector, resolvedRepo) : await getBranchPr(resolvedRepo);
    const [, owner, name] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//);

    return { id, number, owner, repo: name };
};

export const getFiles = async ({ owner, repo, number }) => {
    const jq = ".data.repository.pullRequest.files.nodes[]";
    const args = ["api", "graphql", "--paginate", "-f", `query=${FILES_QUERY}`, "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${number}`, "--jq", jq];
    const stdout = await gh(args);

    return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
};

const buildMutation = (paths, isUnmark) => {
    const mutation = isUnmark ? "unmarkFileAsViewed" : "markFileAsViewed";
    const variables = paths.map((_, index) => `$p${index}: String!`).join(", ");
    const fields = paths.map((_, index) => `f${index}: ${mutation}(input: { pullRequestId: $id, path: $p${index} }) { clientMutationId }`);

    return `mutation($id: ID!, ${variables}) {\n  ${fields.join("\n  ")}\n}`;
};

const setViewedBatch = async (pullRequestId, paths, isUnmark) => {
    const query = buildMutation(paths, isUnmark);
    const pathArgs = paths.flatMap((path, index) => ["-f", `p${index}=${path}`]);
    const args = ["api", "graphql", "-f", `query=${query}`, "-f", `id=${pullRequestId}`, ...pathArgs];
    await gh(args);
};

/** Calls `onDone` after each successful batch so progress prints as it goes */
export const setViewed = async ({ pullRequestId, paths, isUnmark, onDone }) => {
    const failures = [];

    for (let start = 0; start < paths.length; start += MUTATION_BATCH_SIZE) {
        const batch = paths.slice(start, start + MUTATION_BATCH_SIZE);

        try {
            await setViewedBatch(pullRequestId, batch, isUnmark);
            onDone(batch);
        } catch (error) {
            failures.push({ paths: batch, error });
        }
    }

    return failures;
};
