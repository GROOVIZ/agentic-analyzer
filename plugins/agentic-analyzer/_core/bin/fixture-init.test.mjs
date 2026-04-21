import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli  = join(here, "fixture-init.mjs");

function tmp() { return mkdtempSync(join(tmpdir(), "fx-init-")); }
function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }
function run(args) { return spawnSync("node", [cli, ...args], { encoding: "utf8" }); }

test("fixture-init: positive fixture creates target/, expected.json (expected[]), README", () => {
  const dir = tmp();
  try {
    const fx = join(dir, "fx1");
    const r = run([`--dir=${fx}`, "--id-field=cache_id"]);
    assert.equal(r.status, 0, r.stderr);

    assert.ok(existsSync(join(fx, "target")));
    assert.ok(existsSync(join(fx, "target/.gitkeep")));
    assert.ok(existsSync(join(fx, "README.md")));
    assert.ok(existsSync(join(fx, ".gitignore")));

    const exp = JSON.parse(readFileSync(join(fx, "expected.json"), "utf8"));
    assert.ok(Array.isArray(exp.expected));
    assert.equal(exp.expected.length, 1);
    assert.equal(exp.expected[0].cache_id, "TODO:stable-id-string");
    assert.ok(!exp.forbidden, "positive fixture should not seed forbidden[]");
  } finally { cleanup(dir); }
});

test("fixture-init: negative fixture seeds forbidden[]", () => {
  const dir = tmp();
  try {
    const fx = join(dir, "fx1");
    const r = run([`--dir=${fx}`, "--id-field=call_site_id", "--negative"]);
    assert.equal(r.status, 0, r.stderr);

    const exp = JSON.parse(readFileSync(join(fx, "expected.json"), "utf8"));
    assert.ok(Array.isArray(exp.forbidden));
    assert.equal(exp.forbidden.length, 1);
    assert.match(exp.forbidden[0], /TODO/);
    assert.ok(!exp.expected, "negative fixture should not seed expected[]");
  } finally { cleanup(dir); }
});

test("fixture-init: .gitignore excludes actual/", () => {
  const dir = tmp();
  try {
    const fx = join(dir, "fx1");
    run([`--dir=${fx}`, "--id-field=x"]);
    const gi = readFileSync(join(fx, ".gitignore"), "utf8");
    assert.match(gi, /actual\//);
  } finally { cleanup(dir); }
});

test("fixture-init: refuses to overwrite existing dir without --force", () => {
  const dir = tmp();
  try {
    const fx = join(dir, "fx1");
    mkdirSync(fx);
    const r = run([`--dir=${fx}`, "--id-field=x"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /already exists/);
  } finally { cleanup(dir); }
});

test("fixture-init: --force overwrites", () => {
  const dir = tmp();
  try {
    const fx = join(dir, "fx1");
    mkdirSync(fx);
    const r = run([`--dir=${fx}`, "--id-field=x", "--force"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(fx, "expected.json")));
  } finally { cleanup(dir); }
});

test("fixture-init: bad invocation exits 2", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});

test("fixture-init: output uses the supplied id-field in the seeded row", () => {
  const dir = tmp();
  try {
    const fx = join(dir, "fx1");
    run([`--dir=${fx}`, "--id-field=call_site_id"]);
    const exp = JSON.parse(readFileSync(join(fx, "expected.json"), "utf8"));
    assert.equal(exp.expected[0].call_site_id, "TODO:stable-id-string");
    assert.ok(!("cache_id" in exp.expected[0]));
  } finally { cleanup(dir); }
});
