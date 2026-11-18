export const PRESETS = {
    tests: /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|_spec\.rb$|(^|\/)test_[^/]+\.py$|Test\.php$/,
    snapshots: /(^|\/)__snapshots__\/|\.snap$/,
    stories: /\.stories\.(mdx|[cm]?[jt]sx?)$/,
    mocks: /(^|\/)(__mocks__|mocks?)\//,
    fixtures: /(^|\/)(__fixtures__|fixtures)\//,
    locks: /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum)$/,
    types: /\.d\.[cm]?ts$/,
    docs: /\.(md|mdx|rst|txt)$|(^|\/)docs?\//,
    ci: /^\.(github|circleci|gitlab)\/|^\.gitlab-ci\.yml$|^Jenkinsfile$/,
};

const GLOB_CHARS = /[*?[{]/;

const EXCLUDE_PREFIX = "!";

const isExclude = (pattern) => pattern.startsWith(EXCLUDE_PREFIX);

const escapeRegex = (text) => text.replace(/[.+^$()|\\]/g, "\\$&");

const getBasename = (path) => path.slice(path.lastIndexOf("/") + 1);

/** Supports `**`, `*`, `?`, `{a,b}` and `[...]`, enough for path filters without a glob dependency */
export const globToRegex = (glob) => {
    let source = "";
    let braceDepth = 0;

    for (let index = 0; index < glob.length; index++) {
        const char = glob[index];

        if (char === "*" && glob[index + 1] === "*") {
            const isSegment = glob[index + 2] === "/";
            source += isSegment ? "(?:.*/)?" : ".*";
            index += isSegment ? 2 : 1;
        } else if (char === "*") {
            source += "[^/]*";
        } else if (char === "?") {
            source += "[^/]";
        } else if (char === "[") {
            const end = glob.indexOf("]", index + 1);
            const hasClosingBracket = end !== -1;
            source += hasClosingBracket ? glob.slice(index, end + 1).replace(/^\[[!^]/, "[^/") : "\\[";
            index = hasClosingBracket ? end : index;
        } else if (char === "{") {
            braceDepth++;
            source += "(?:";
        } else if (char === "}" && braceDepth > 0) {
            braceDepth--;
            source += ")";
        } else if (char === "," && braceDepth > 0) {
            source += "|";
        } else {
            source += escapeRegex(char);
        }
    }

    return new RegExp(`^${source}$`);
};

/**
 * Forms are checked in order: preset, glob, path (contains "/"), then bare word (extension or exact file name).
 * A leading "./" or trailing "/" forces a path, so a folder named like a preset stays reachable.
 */
const toMatcher = (rawPattern) => {
    const isRooted = rawPattern.startsWith("./");
    const isForcedPath = isRooted || rawPattern.endsWith("/");
    const pattern = rawPattern.replace(/^\.\//, "");
    const presetName = pattern.toLowerCase();
    const isPreset = !isForcedPath && Object.hasOwn(PRESETS, presetName);
    if (isPreset) {
        return (path) => PRESETS[presetName].test(path);
    }

    if (GLOB_CHARS.test(pattern)) {
        const regex = globToRegex(pattern);
        const isBasenameGlob = !isRooted && !pattern.includes("/");
        return (path) => regex.test(isBasenameGlob ? getBasename(path) : path);
    }

    if (isForcedPath || pattern.includes("/")) {
        const dir = pattern.endsWith("/") ? pattern : `${pattern}/`;
        return (path) => path === pattern || path.startsWith(dir);
    }

    const extension = `.${pattern.replace(/^\./, "").toLowerCase()}`;
    return (path) => path.toLowerCase().endsWith(extension) || getBasename(path) === pattern;
};

export const createFilter = (patterns) => {
    const includes = patterns.filter((pattern) => !isExclude(pattern)).map(toMatcher);
    const isIncluded = (path) => includes.length === 0 || includes.some((matches) => matches(path));
    const excludes = patterns.filter(isExclude).map((pattern) => toMatcher(pattern.slice(EXCLUDE_PREFIX.length)));

    return (path) => isIncluded(path) && !excludes.some((matches) => matches(path));
};
