import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFilter, globToRegex } from "../src/matcher.mjs";

const FILES = [
    ".github/workflows/ci.yml",
    "README.md",
    "Makefile",
    "package.json",
    "pnpm-lock.yaml",
    "src/components/Button.tsx",
    "src/components/Button.test.tsx",
    "src/components/Button.stories.tsx",
    "src/components/__snapshots__/Button.test.tsx.snap",
    "src/components/ui/Card.ts",
    "src/componentsLegacy/Old.ts",
    "src/config/app.JSON",
    "src/legacy/old.ts",
    "src/types/api.d.ts",
    "src/utils/__tests__/format.ts",
    "tests/e2e/checkout.spec.ts",
    "server/handler_test.go",
    "app/tests/Unit/OrderTest.php",
];

const select = (...patterns) => FILES.filter(createFilter(patterns));

describe("folder and file paths", () => {
    it("matches everything under a folder, with or without a trailing slash", () => {
        const expected = [
            "src/components/Button.tsx",
            "src/components/Button.test.tsx",
            "src/components/Button.stories.tsx",
            "src/components/__snapshots__/Button.test.tsx.snap",
            "src/components/ui/Card.ts",
        ];

        assert.deepEqual(select("src/components/"), expected);
        assert.deepEqual(select("src/components"), expected);
        assert.deepEqual(select("./src/components"), expected);
    });

    it("does not match a sibling folder sharing the prefix", () => {
        assert.ok(!select("src/components").includes("src/componentsLegacy/Old.ts"));
    });

    it("matches one exact file", () => {
        assert.deepEqual(select("src/legacy/old.ts"), ["src/legacy/old.ts"]);
    });
});

describe("globs", () => {
    it("anchors globs containing a slash to the repo root", () => {
        assert.deepEqual(select("src/components/**/*.ts"), ["src/components/ui/Card.ts"]);
        assert.deepEqual(select("src/*/Card.ts"), []);
    });

    it("expands braces", () => {
        assert.deepEqual(select("src/components/*.{ts,tsx}"), [
            "src/components/Button.tsx",
            "src/components/Button.test.tsx",
            "src/components/Button.stories.tsx",
        ]);
    });

    it("matches a slash-free glob against the file name at any depth", () => {
        assert.deepEqual(select("*.json"), ["package.json"]);
        assert.deepEqual(select("Button.t*"), ["src/components/Button.tsx", "src/components/Button.test.tsx", "src/components/__snapshots__/Button.test.tsx.snap"]);
    });

    it("supports character classes and negated classes", () => {
        assert.ok(globToRegex("[ab].ts").test("a.ts"));
        assert.ok(!globToRegex("[!ab].ts").test("a.ts"));
        assert.ok(globToRegex("[!ab].ts").test("c.ts"));
    });

    it("keeps `*` inside one path segment", () => {
        assert.ok(!globToRegex("src/*.ts").test("src/a/b.ts"));
        assert.ok(globToRegex("src/**").test("src/a/b.ts"));
    });
});

describe("extensions", () => {
    it("matches with or without the dot, ignoring case", () => {
        const expected = ["package.json", "src/config/app.JSON"];
        assert.deepEqual(select("json"), expected);
        assert.deepEqual(select(".json"), expected);
    });

    it("treats a bare word as an exact file name too", () => {
        assert.deepEqual(select("Makefile"), ["Makefile"]);
    });
});

describe("presets", () => {
    it("tests covers JS/TS, Go, and PHP test files and test folders", () => {
        assert.deepEqual(select("tests"), [
            "src/components/Button.test.tsx",
            "src/utils/__tests__/format.ts",
            "tests/e2e/checkout.spec.ts",
            "server/handler_test.go",
            "app/tests/Unit/OrderTest.php",
        ]);
    });

    it("is case-insensitive", () => {
        assert.deepEqual(select("TESTS"), select("tests"));
    });

    it("ignores inherited object keys", () => {
        assert.deepEqual(select("constructor"), []);
    });

    it("each remaining preset matches only its own files", () => {
        assert.deepEqual(select("snapshots"), ["src/components/__snapshots__/Button.test.tsx.snap"]);
        assert.deepEqual(select("stories"), ["src/components/Button.stories.tsx"]);
        assert.deepEqual(select("locks"), ["pnpm-lock.yaml"]);
        assert.deepEqual(select("types"), ["src/types/api.d.ts"]);
        assert.deepEqual(select("docs"), ["README.md"]);
        assert.deepEqual(select("ci"), [".github/workflows/ci.yml"]);
    });
});

describe("combining patterns", () => {
    it("unions includes", () => {
        assert.deepEqual(select("locks", "types"), ["pnpm-lock.yaml", "src/types/api.d.ts"]);
    });

    it("removes excludes of any form", () => {
        const expected = ["src/components/ui/Card.ts", "src/componentsLegacy/Old.ts", "src/types/api.d.ts"];
        assert.deepEqual(select("src/**", "!src/legacy/", "!tests", "!*.tsx", "!snap", "!json"), expected);
    });

    it("matches everything except excludes when only excludes are given", () => {
        assert.deepEqual(select("!src/**", "!tests"), [".github/workflows/ci.yml", "README.md", "Makefile", "package.json", "pnpm-lock.yaml"]);
    });
});
