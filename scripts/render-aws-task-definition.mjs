import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const PLACEHOLDER_PATTERN = /__([A-Z0-9_]+)__/g;

function parseAssignments(assignments) {
  const values = {};

  for (const assignment of assignments) {
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Expected KEY=VALUE assignment, received: ${assignment}`);
    }

    const key = assignment.slice(0, separatorIndex);
    const value = assignment.slice(separatorIndex + 1);
    values[key] = value;
  }

  return values;
}

export function renderTaskDefinitionTemplate(template, replacements) {
  const missing = new Set();
  const rendered = template.replaceAll(PLACEHOLDER_PATTERN, (placeholder, key) => {
    if (!(key in replacements)) {
      missing.add(key);
      return placeholder;
    }

    return replacements[key];
  });

  if (missing.size > 0) {
    throw new Error(`Missing replacements: ${Array.from(missing).sort().join(", ")}`);
  }

  const unresolved = rendered.match(PLACEHOLDER_PATTERN);
  if (unresolved) {
    throw new Error(`Unresolved placeholders remain: ${unresolved.join(", ")}`);
  }

  return rendered;
}

export async function renderTaskDefinitionFile({
  outputPath,
  replacements,
  templatePath,
}) {
  const template = await readFile(templatePath, "utf8");
  const rendered = renderTaskDefinitionTemplate(template, replacements);
  JSON.parse(rendered);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${rendered}\n`, "utf8");
  return outputPath;
}

async function main(argv) {
  const [templatePath, outputPath, ...assignments] = argv;

  if (!templatePath || !outputPath || assignments.length === 0) {
    throw new Error(
      "Usage: node scripts/render-aws-task-definition.mjs <template> <output> KEY=VALUE...",
    );
  }

  const replacements = parseAssignments(assignments);
  await renderTaskDefinitionFile({ outputPath, replacements, templatePath });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
