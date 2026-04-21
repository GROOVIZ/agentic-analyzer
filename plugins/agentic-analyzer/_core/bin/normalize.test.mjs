import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, sha256, normalizedSha256 } from "./normalize.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "normalize.mjs");

test("normalize: trims leading and trailing whitespace per line", () => {
  assert.equal(normalize("  foo  \n  bar  "), "foo\nbar");
});

test("normalize: collapses runs of internal whitespace to single space", () => {
  assert.equal(normalize("foo   bar\tbaz"), "foo bar baz");
});

test("normalize: strips blank lines", () => {
  assert.equal(normalize("foo\n\n\nbar\n"), "foo\nbar");
});

test("normalize: handles Windows line endings", () => {
  assert.equal(normalize("foo\r\nbar\r\n"), "foo\nbar");
});

test("normalize: idempotent", () => {
  const input = "  @Cacheable(\"books\")\n\n  public Book findBook( ISBN isbn ) { ... }  ";
  const once = normalize(input);
  const twice = normalize(once);
  assert.equal(once, twice);
});

test("sha256: deterministic", () => {
  assert.equal(sha256("hello"), sha256("hello"));
  assert.notEqual(sha256("hello"), sha256("world"));
});

test("sha256: produces 64-char lowercase hex", () => {
  assert.match(sha256("anything"), /^[0-9a-f]{64}$/);
});

test("normalizedSha256: whitespace-only edits do not change the hash", () => {
  const a = "  @Cacheable(\"books\")\n  public Book findBook() {}  ";
  const b = "@Cacheable(\"books\")\n\n    public Book    findBook() {}";
  assert.equal(normalizedSha256(a), normalizedSha256(b));
});

test("normalizedSha256: semantic edits change the hash", () => {
  const a = "@Cacheable(\"books\")";
  const b = "@Cacheable(\"authors\")";
  assert.notEqual(normalizedSha256(a), normalizedSha256(b));
});

test("CLI: reads stdin and prints both hashes tab-separated", () => {
  const r = spawnSync("node", [cli], {
    input: "  hello  world  ",
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const [raw, normalized] = r.stdout.trim().split("\t");
  assert.match(raw, /^[0-9a-f]{64}$/);
  assert.match(normalized, /^[0-9a-f]{64}$/);
  assert.notEqual(raw, normalized, "raw and normalized should differ for whitespace-padded input");
});
