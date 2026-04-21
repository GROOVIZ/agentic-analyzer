import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function normalize(input) {
  return input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(line => line.length > 0)
    .join("\n");
}

export function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizedSha256(input) {
  return sha256(normalize(input));
}

const invokedAsCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCli) {
  const input = readFileSync(0, "utf8");
  process.stdout.write(`${sha256(input)}\t${normalizedSha256(input)}\n`);
}
