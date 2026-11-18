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

const PR_URL = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+/;

export const isPrUrl = (value) => PR_URL.test(value);

/** `[HOST/]OWNER/REPO`, as `gh -R` takes it; without a host, gh uses its default host */
const getHostArgs = (repo) => {
    const segments = repo.split("/");
    return segments.length === 3 ? ["--hostname", segments[0]] : [];
};

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

/** PRs live on the upstream repo, so a fork resolves to its parent (always on the same host) */
const getDefaultRepo = async () => {
    const { url, nameWithOwner, parent } = await ghJson(["repo", "view", "--json", "url,nameWithOwner,parent"]);
    const { host } = new URL(url);
    const repo = parent ? `${parent.owner.login}/${parent.name}` : nameWithOwner;
    return `${host}/${repo}`;
};

/**
 * `gh pr list --head` matches the branch name on every fork, so a common name like `main` can hit a
 * stranger's PR. Only a PR from the base repo itself or from the viewer's own fork counts.
 */
const getBranchPr = async (repo) => {
    const getBranch = exec("git", ["branch", "--show-current"]);
    const getViewer = gh(["api", "user", ...getHostArgs(repo), "--jq", ".login"]);
    const [branch, viewer] = await Promise.all([getBranch, getViewer]);
    if (!branch) {
        throw new Error("Detached HEAD: pass a PR number or URL");
    }

    const fields = `${PR_FIELDS},isCrossRepository,headRepositoryOwner`;
    const args = ["pr", "list", "-R", repo, "--head", branch, "--state", "open", "--limit", "20", "--json", fields];
    const isOwn = ({ isCrossRepository, headRepositoryOwner }) => !isCrossRepository || headRepositoryOwner.login === viewer;
    const pullRequest = (await ghJson(args)).find(isOwn);
    if (!pullRequest) {
        throw new Error(`No open PR in ${repo} for branch "${branch}" from ${viewer} or the base repo`);
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
    const { host, pathname } = new URL(url);
    const [, owner, name] = pathname.split("/");

    return { id, host, number, owner, repo: name };
};

export const getFiles = async ({ host, owner, repo, number }) => {
    const jq = ".data.repository.pullRequest.files.nodes[]";
    const variables = ["-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${number}`];
    const args = ["api", "graphql", "--hostname", host, "--paginate", "-f", `query=${FILES_QUERY}`, ...variables, "--jq", jq];
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

const setViewedBatch = async ({ id, host }, paths, isUnmark) => {
    const query = buildMutation(paths, isUnmark);
    const pathArgs = paths.flatMap((path, index) => ["-f", `p${index}=${path}`]);
    const args = ["api", "graphql", "--hostname", host, "-f", `query=${query}`, "-f", `id=${id}`, ...pathArgs];
    await gh(args);
};

/** Calls `onDone` after each successful batch so progress prints as it goes */
export const setViewed = async ({ pullRequest, paths, isUnmark, onDone }) => {
    const failures = [];

    for (let start = 0; start < paths.length; start += MUTATION_BATCH_SIZE) {
        const batch = paths.slice(start, start + MUTATION_BATCH_SIZE);

        try {
            await setViewedBatch(pullRequest, batch, isUnmark);
            onDone(batch);
        } catch (error) {
            failures.push({ paths: batch, error });
        }
    }

    return failures;
};
