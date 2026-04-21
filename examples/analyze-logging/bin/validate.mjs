import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { argv, exit, stderr } from "node:process";

if (argv.length !== 4) {
  stderr.write("usage: node validate.mjs <schema.json> <data.json>\n");
  exit(2);
}

const [, , schemaPath, dataPath] = argv;

let schema, data;
try {
  schema = JSON.parse(readFileSync(schemaPath, "utf8"));
} catch (e) {
  stderr.write(`schema read failed (${schemaPath}): ${e.message}\n`);
  exit(2);
}
try {
  data = JSON.parse(readFileSync(dataPath, "utf8"));
} catch (e) {
  stderr.write(`data read failed (${dataPath}): ${e.message}\n`);
  exit(2);
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (validate(data)) {
  exit(0);
}
for (const err of validate.errors) {
  stderr.write(`${err.instancePath || "/"} ${err.message}`);
  if (err.params && Object.keys(err.params).length) {
    stderr.write(` (${JSON.stringify(err.params)})`);
  }
  stderr.write("\n");
}
exit(1);
