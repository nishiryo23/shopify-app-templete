import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseForESLint } from "@typescript-eslint/parser";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFilePattern = /\.[cm]?[jt]sx?$/;
const directAdminCodeTokens = ["admin.graphql(", "clients.Graphql"];
const directAdminModuleSpecifiers = ["@shopify/admin-api-client"];

const fixtureCases = [
  {
    name: "valid fixtures",
    root: "tests/fixtures/guardrails/valid",
    expectedCodes: [],
  },
  {
    name: "invalid route imports domain",
    root: "tests/fixtures/guardrails/invalid/route-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route dynamic imports domain",
    root: "tests/fixtures/guardrails/invalid/route-dynamic-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route variable imports domain",
    root: "tests/fixtures/guardrails/invalid/route-variable-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route reassigned imports domain",
    root: "tests/fixtures/guardrails/invalid/route-reassigned-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route member imports domain",
    root: "tests/fixtures/guardrails/invalid/route-member-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route template imports domain",
    root: "tests/fixtures/guardrails/invalid/route-template-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route inline business logic",
    root: "tests/fixtures/guardrails/invalid/route-inline-business-logic",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route const inline business logic",
    root: "tests/fixtures/guardrails/invalid/route-const-inline-business-logic",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route dynamic import bypass",
    root: "tests/fixtures/guardrails/invalid/route-dynamic-import-bypass",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route dynamic import promise chain bypass",
    root: "tests/fixtures/guardrails/invalid/route-dynamic-import-promise-chain-bypass",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route exported binding inline business logic",
    root: "tests/fixtures/guardrails/invalid/route-exported-binding-inline-business-logic",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route assigned imported binding bypass",
    root: "tests/fixtures/guardrails/invalid/route-assigned-imported-binding-bypass",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route typed assigned imported binding bypass",
    root: "tests/fixtures/guardrails/invalid/route-typed-assigned-imported-binding-bypass",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route inline typed assigned imported binding bypass",
    root: "tests/fixtures/guardrails/invalid/route-inline-typed-assigned-imported-binding-bypass",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route member access imported binding bypass",
    root: "tests/fixtures/guardrails/invalid/route-member-access-imported-binding-bypass",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route shadowed imported binding bypass",
    root: "tests/fixtures/guardrails/invalid/route-shadowed-imported-binding-bypass",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route imported webhook handler re-export",
    root: "tests/fixtures/guardrails/invalid/route-imported-webhook-handler-reexport",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route namespace member reference export",
    root: "tests/fixtures/guardrails/invalid/route-namespace-member-reference-export",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid direct admin access",
    root: "tests/fixtures/guardrails/invalid/direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access", "route-service-boundary"],
  },
  {
    name: "invalid direct admin access single file",
    root: "tests/fixtures/guardrails/invalid/direct-admin-access-single-file",
    expectedCodes: ["no-direct-admin-api-access", "route-service-boundary"],
  },
  {
    name: "invalid dynamic direct admin access",
    root: "tests/fixtures/guardrails/invalid/dynamic-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access", "route-service-boundary"],
  },
  {
    name: "invalid template direct admin access",
    root: "tests/fixtures/guardrails/invalid/template-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access", "route-service-boundary"],
  },
  {
    name: "invalid scripts direct admin access",
    root: "tests/fixtures/guardrails/invalid/scripts-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid concatenated fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/concatenated-fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid split fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/split-fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid variable fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/variable-fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid reassigned fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/reassigned-fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid member fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/member-fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid aliased fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/aliased-fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid aliased request direct admin access",
    root: "tests/fixtures/guardrails/invalid/aliased-request-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid aliased axios direct admin access",
    root: "tests/fixtures/guardrails/invalid/aliased-axios-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid destructured axios direct admin access",
    root: "tests/fixtures/guardrails/invalid/destructured-axios-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid chained destructured axios direct admin access",
    root: "tests/fixtures/guardrails/invalid/chained-destructured-axios-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid typed chained destructured axios direct admin access",
    root: "tests/fixtures/guardrails/invalid/typed-chained-destructured-axios-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid global fetch direct admin access",
    root: "tests/fixtures/guardrails/invalid/global-fetch-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid url object direct admin access",
    root: "tests/fixtures/guardrails/invalid/url-object-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid url object href direct admin access",
    root: "tests/fixtures/guardrails/invalid/url-object-href-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid url object toString direct admin access",
    root: "tests/fixtures/guardrails/invalid/url-object-tostring-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid axios request object config direct admin access",
    root: "tests/fixtures/guardrails/invalid/axios-request-object-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access"],
  },
  {
    name: "invalid webhook direct admin access",
    root: "tests/fixtures/guardrails/invalid/webhook-direct-admin-access",
    expectedCodes: ["no-direct-admin-api-access", "no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook import normalized escape",
    root: "tests/fixtures/guardrails/invalid/webhook-imports-normalized-escape",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook inline business logic",
    root: "tests/fixtures/guardrails/invalid/webhook-inline-business-logic",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook inline local business logic",
    root: "tests/fixtures/guardrails/invalid/webhook-inline-local-business-logic",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook const inline local business logic",
    root: "tests/fixtures/guardrails/invalid/webhook-const-inline-local-business-logic",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook dynamic import bypass",
    root: "tests/fixtures/guardrails/invalid/webhook-dynamic-import-bypass",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook dynamic import promise chain bypass",
    root: "tests/fixtures/guardrails/invalid/webhook-dynamic-import-promise-chain-bypass",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook exported binding inline business logic",
    root: "tests/fixtures/guardrails/invalid/webhook-exported-binding-inline-business-logic",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook member access imported binding bypass",
    root: "tests/fixtures/guardrails/invalid/webhook-member-access-imported-binding-bypass",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook shadowed imported binding bypass",
    root: "tests/fixtures/guardrails/invalid/webhook-shadowed-imported-binding-bypass",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook imported service handler re-export",
    root: "tests/fixtures/guardrails/invalid/webhook-imported-service-handler-reexport",
    expectedCodes: ["no-webhook-inline-business-logic"],
  },
  {
    name: "invalid webhook settings page imports domain",
    root: "tests/fixtures/guardrails/invalid/webhook-settings-page-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid webhooks index page imports domain",
    root: "tests/fixtures/guardrails/invalid/webhooks-index-page-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid webhooks flat index page imports domain",
    root: "tests/fixtures/guardrails/invalid/webhooks-flat-index-page-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid webhooks nested index page imports domain",
    root: "tests/fixtures/guardrails/invalid/webhooks-nested-index-page-imports-domain",
    expectedCodes: ["route-service-boundary"],
  },
  {
    name: "invalid route precomputed business logic",
    root: "tests/fixtures/guardrails/invalid/route-precomputed-business-logic",
    expectedCodes: ["route-service-boundary"],
  },
];

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function isDeclarationFile(filePath) {
  return /\.d\.[cm]?[jt]sx?$/.test(filePath);
}

function isSourceFile(filePath) {
  return sourceFilePattern.test(filePath) && !isDeclarationFile(filePath);
}

async function walkFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && isSourceFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function listFiles(rootDir) {
  try {
    return await walkFiles(rootDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readImports(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return scanSource(content);
}

function isIdentifierChar(value) {
  return /[A-Za-z0-9_$]/.test(value);
}

function hasWordAt(content, index, word) {
  if (!content.startsWith(word, index)) {
    return false;
  }

  const previousChar = index > 0 ? content[index - 1] : "";
  const nextChar = content[index + word.length] ?? "";

  return !isIdentifierChar(previousChar) && !isIdentifierChar(nextChar);
}

function readQuotedLiteral(content, startIndex) {
  const quote = content[startIndex];
  let index = startIndex + 1;
  let value = "";

  while (index < content.length) {
    const char = content[index];

    if (char === "\\") {
      value += content.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === quote) {
      return { value, end: index + 1 };
    }

    value += char;
    index += 1;
  }

  return { value, end: content.length };
}

function readTemplateLiteral(content, startIndex) {
  let index = startIndex + 1;
  let value = "";

  while (index < content.length) {
    const char = content[index];

    if (char === "\\") {
      value += content.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === "`") {
      return { value, end: index + 1 };
    }

    if (char === "$" && content[index + 1] === "{") {
      const expression = readTemplateExpression(content, index + 2);
      value += "${" + expression.value + "}";
      index = expression.end;
      continue;
    }

    value += char;
    index += 1;
  }

  return { value, end: content.length };
}

function readTemplateExpression(content, startIndex) {
  let depth = 1;
  let index = startIndex;
  let value = "";

  while (index < content.length) {
    const char = content[index];

    if (char === "'" || char === "\"") {
      const stringLiteral = readQuotedLiteral(content, index);
      value += content.slice(index, stringLiteral.end);
      index = stringLiteral.end;
      continue;
    }

    if (char === "`") {
      const templateLiteral = readTemplateLiteral(content, index);
      value += content.slice(index, templateLiteral.end);
      index = templateLiteral.end;
      continue;
    }

    if (char === "/" && content[index + 1] === "/") {
      const lineCommentEnd = content.indexOf("\n", index + 2);
      const end = lineCommentEnd === -1 ? content.length : lineCommentEnd;
      value += content.slice(index, end);
      index = end;
      continue;
    }

    if (char === "/" && content[index + 1] === "*") {
      const blockCommentEnd = content.indexOf("*/", index + 2);
      const end = blockCommentEnd === -1 ? content.length : blockCommentEnd + 2;
      value += content.slice(index, end);
      index = end;
      continue;
    }

    if (char === "{") {
      depth += 1;
      value += char;
      index += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return { value, end: index + 1 };
      }

      value += char;
      index += 1;
      continue;
    }

    value += char;
    index += 1;
  }

  return { value, end: content.length };
}

function skipTrivia(content, startIndex) {
  let index = startIndex;

  while (index < content.length) {
    const char = content[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "/" && content[index + 1] === "/") {
      const lineCommentEnd = content.indexOf("\n", index + 2);
      index = lineCommentEnd === -1 ? content.length : lineCommentEnd;
      continue;
    }

    if (char === "/" && content[index + 1] === "*") {
      const blockCommentEnd = content.indexOf("*/", index + 2);
      index = blockCommentEnd === -1 ? content.length : blockCommentEnd + 2;
      continue;
    }

    break;
  }

  return index;
}

function readModuleSpecifierLiteral(content, startIndex) {
  const index = skipTrivia(content, startIndex);
  const char = content[index];

  if (char === "'" || char === "\"") {
    return readQuotedLiteral(content, index);
  }

  if (char === "`") {
    return readTemplateLiteral(content, index);
  }

  return null;
}

function findFromSpecifier(content, startIndex) {
  let index = startIndex;

  while (index < content.length) {
    index = skipTrivia(content, index);

    if (hasWordAt(content, index, "from")) {
      return readModuleSpecifierLiteral(content, index + "from".length);
    }

    const char = content[index];

    if (char === ";" || char === "\n" || char === "\r" || char === undefined) {
      return null;
    }

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(content, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(content, index).end;
      continue;
    }

    index += 1;
  }

  return null;
}

function readImportSpecifiers(content) {
  const imports = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "/" && content[index + 1] === "/") {
      const lineCommentEnd = content.indexOf("\n", index + 2);
      index = lineCommentEnd === -1 ? content.length : lineCommentEnd;
      continue;
    }

    if (char === "/" && content[index + 1] === "*") {
      const blockCommentEnd = content.indexOf("*/", index + 2);
      index = blockCommentEnd === -1 ? content.length : blockCommentEnd + 2;
      continue;
    }

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(content, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(content, index).end;
      continue;
    }

    if (hasWordAt(content, index, "import")) {
      const nextIndex = skipTrivia(content, index + "import".length);

      if (content[nextIndex] === "(") {
        const specifier = readModuleSpecifierLiteral(content, nextIndex + 1);

        if (specifier) {
          imports.push(specifier.value);
        }
      } else {
        const sideEffectImport = readModuleSpecifierLiteral(content, nextIndex);

        if (sideEffectImport) {
          imports.push(sideEffectImport.value);
        } else {
          const fromSpecifier = findFromSpecifier(content, nextIndex);

          if (fromSpecifier) {
            imports.push(fromSpecifier.value);
          }
        }
      }

      index += "import".length;
      continue;
    }

    if (hasWordAt(content, index, "export")) {
      const fromSpecifier = findFromSpecifier(content, index + "export".length);

      if (fromSpecifier) {
        imports.push(fromSpecifier.value);
      }

      index += "export".length;
      continue;
    }

    if (hasWordAt(content, index, "require")) {
      const nextIndex = skipTrivia(content, index + "require".length);

      if (content[nextIndex] === "(") {
        const specifier = readModuleSpecifierLiteral(content, nextIndex + 1);

        if (specifier) {
          imports.push(specifier.value);
        }
      }

      index += "require".length;
      continue;
    }

    index += 1;
  }

  return [...new Set(imports)];
}

function readIdentifier(content, startIndex) {
  const match = content.slice(startIndex).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);

  if (!match) {
    return null;
  }

  return { value: match[0], end: startIndex + match[0].length };
}

function readExpression(content, startIndex, options = {}) {
  const {
    stopOnComma = false,
    stopOnSemicolon = false,
    stopOnParen = false,
  } = options;
  let index = skipTrivia(content, startIndex);
  let value = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "'" || char === "\"") {
      const stringLiteral = readQuotedLiteral(content, index);
      value += content.slice(index, stringLiteral.end);
      index = stringLiteral.end;
      continue;
    }

    if (char === "`") {
      const templateLiteral = readTemplateLiteral(content, index);
      value += content.slice(index, templateLiteral.end);
      index = templateLiteral.end;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      value += char;
      index += 1;
      continue;
    }

    if (char === ")") {
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && stopOnParen) {
        return { value: value.trim(), end: index };
      }

      parenDepth -= 1;
      value += char;
      index += 1;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      value += char;
      index += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth -= 1;
      value += char;
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      value += char;
      index += 1;
      continue;
    }

    if (char === "}") {
      braceDepth -= 1;
      value += char;
      index += 1;
      continue;
    }

    if (
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      ((stopOnComma && char === ",") || (stopOnSemicolon && char === ";"))
    ) {
      return { value: value.trim(), end: index };
    }

    value += char;
    index += 1;
  }

  return { value: value.trim(), end: index };
}

function collectVariableAssignments(content) {
  const assignments = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(content, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(content, index).end;
      continue;
    }

    const declarationKeyword =
      (hasWordAt(content, index, "const") && "const") ||
      (hasWordAt(content, index, "let") && "let") ||
      (hasWordAt(content, index, "var") && "var");

    if (declarationKeyword) {
      const patternStartIndex = skipTrivia(content, index + declarationKeyword.length);

      if (content[patternStartIndex] === "{") {
        const pattern = readBalancedBlock(content, patternStartIndex, "{", "}");

        if (!pattern) {
          index += declarationKeyword.length;
          continue;
        }

        const equalsIndex = skipTypeAnnotation(content, pattern.end);

        if (content[equalsIndex] !== "=" || content[equalsIndex + 1] === "=") {
          index = pattern.end;
          continue;
        }

        const expression = readExpression(content, equalsIndex + 1, {
          stopOnSemicolon: true,
        });
        const baseReference = readSimpleReference(expression.value.trim());

        if (baseReference) {
          for (const entry of splitTopLevel(pattern.value, ",")) {
            const trimmedEntry = entry.trim();

            if (!trimmedEntry || trimmedEntry.startsWith("...")) {
              continue;
            }

            const separatorIndex = findTopLevelPropertySeparator(trimmedEntry);
            const propertyExpression =
              separatorIndex === -1 ? trimmedEntry : trimmedEntry.slice(0, separatorIndex);
            const localBindingExpression =
              separatorIndex === -1 ? trimmedEntry : trimmedEntry.slice(separatorIndex + 1);
            const propertyKey = parseObjectPropertyKey(propertyExpression.trim());

            if (!propertyKey) {
              continue;
            }

            const localBinding = readIdentifier(
              localBindingExpression.split("=")[0].trim(),
              0,
            );

            if (!localBinding) {
              continue;
            }

            assignments.push({
              name: localBinding.value,
              expression: `${baseReference}.${propertyKey}`,
            });
          }
        }

        index = expression.end;
        continue;
      }
    }

    const identifier = declarationKeyword
      ? readIdentifier(content, skipTrivia(content, index + declarationKeyword.length))
      : readIdentifier(content, index);

    if (!identifier) {
      index += declarationKeyword ? declarationKeyword.length : 1;
      continue;
    }

    if (!declarationKeyword) {
      const previousChar = index > 0 ? content[index - 1] : "";

      if (isIdentifierChar(previousChar) || previousChar === ".") {
        index = identifier.end;
        continue;
      }
    }

    const equalsIndex = skipTypeAnnotation(content, identifier.end);

    if (content[equalsIndex] !== "=" || content[equalsIndex + 1] === "=") {
      index = identifier.end;
      continue;
    }

    const expression = readExpression(content, equalsIndex + 1, {
      stopOnSemicolon: true,
    });

    assignments.push({
      name: identifier.value,
      expression: expression.value,
    });
    index = expression.end;
  }

  return assignments;
}

function skipTypeAnnotation(content, startIndex) {
  let index = skipTrivia(content, startIndex);

  if (content[index] !== ":") {
    return index;
  }

  index = skipTrivia(content, index + 1);
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(content, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(content, index).end;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (char === ")") {
      parenDepth -= 1;
      index += 1;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth -= 1;
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      if (braceDepth === 0) {
        return index;
      }

      braceDepth -= 1;
      index += 1;
      continue;
    }

    if (char === "<") {
      angleDepth += 1;
      index += 1;
      continue;
    }

    if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      index += 1;
      continue;
    }

    if (
      char === "=" &&
      content[index + 1] !== ">" &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0
    ) {
      return index;
    }

    if (
      char === ";" &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0
    ) {
      return index;
    }

    index += 1;
  }

  return index;
}

function unwrapParenthesizedExpression(expression) {
  let trimmed = expression.trim();

  while (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    const innerExpression = readExpression(trimmed, 1, {
      stopOnParen: true,
    });

    if (innerExpression.end !== trimmed.length - 1) {
      break;
    }

    trimmed = innerExpression.value.trim();
  }

  return trimmed;
}

function splitTopLevel(expression, delimiter) {
  const parts = [];
  let current = "";
  let index = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === "'" || char === "\"") {
      const stringLiteral = readQuotedLiteral(expression, index);
      current += expression.slice(index, stringLiteral.end);
      index = stringLiteral.end;
      continue;
    }

    if (char === "`") {
      const templateLiteral = readTemplateLiteral(expression, index);
      current += expression.slice(index, templateLiteral.end);
      index = templateLiteral.end;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      current += char;
      index += 1;
      continue;
    }

    if (char === ")") {
      parenDepth -= 1;
      current += char;
      index += 1;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      current += char;
      index += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth -= 1;
      current += char;
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      current += char;
      index += 1;
      continue;
    }

    if (char === "}") {
      braceDepth -= 1;
      current += char;
      index += 1;
      continue;
    }

    if (
      char === delimiter &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      parts.push(current.trim());
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  parts.push(current.trim());
  return parts.filter(Boolean);
}

function splitTopLevelByPlus(expression) {
  return splitTopLevel(expression, "+");
}

function findTopLevelPropertySeparator(expression) {
  let index = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(expression, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(expression, index).end;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (char === ")") {
      parenDepth -= 1;
      index += 1;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth -= 1;
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      braceDepth -= 1;
      index += 1;
      continue;
    }

    if (
      char === ":" &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    }

    index += 1;
  }

  return -1;
}

function resolveStringLiteral(expression) {
  const trimmed = unwrapParenthesizedExpression(expression);

  if (trimmed.startsWith("'") || trimmed.startsWith("\"")) {
    const stringLiteral = readQuotedLiteral(trimmed, 0);

    if (stringLiteral.end === trimmed.length) {
      return stringLiteral.value;
    }
  }

  if (trimmed.startsWith("`")) {
    const templateLiteral = readTemplateLiteral(trimmed, 0);

    if (templateLiteral.end === trimmed.length) {
      return templateLiteral.value;
    }
  }

  return null;
}

function parseObjectPropertyKey(expression) {
  const trimmed = expression.trim();
  const literal = resolveStringLiteral(trimmed);

  if (literal !== null) {
    return literal;
  }

  const identifier = readIdentifier(trimmed, 0);

  if (identifier && identifier.end === trimmed.length) {
    return identifier.value;
  }

  return null;
}

function resolveStaticStringExpression(expression, resolvedBindings, seen = new Set()) {
  const trimmed = unwrapParenthesizedExpression(expression);
  const literal = resolveStringLiteral(trimmed);

  if (literal !== null) {
    return literal;
  }

  const identifier = readIdentifier(trimmed, 0);

  if (identifier && identifier.end === trimmed.length) {
    if (seen.has(identifier.value) || !resolvedBindings.has(identifier.value)) {
      return null;
    }

    return resolvedBindings.get(identifier.value);
  }

  const memberExpressionMatch = trimmed.match(
    /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/,
  );

  if (memberExpressionMatch) {
    if (memberExpressionMatch[2] === "href" && resolvedBindings.has(memberExpressionMatch[1])) {
      return resolvedBindings.get(memberExpressionMatch[1]);
    }

    const bindingKey = `${memberExpressionMatch[1]}.${memberExpressionMatch[2]}`;

    if (resolvedBindings.has(bindingKey)) {
      return resolvedBindings.get(bindingKey);
    }
  }

  const bracketExpressionMatch = trimmed.match(
    /^([A-Za-z_$][A-Za-z0-9_$]*)\[(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\2\]$/,
  );

  if (bracketExpressionMatch) {
    if (bracketExpressionMatch[3] === "href" && resolvedBindings.has(bracketExpressionMatch[1])) {
      return resolvedBindings.get(bracketExpressionMatch[1]);
    }

    const bindingKey = `${bracketExpressionMatch[1]}.${bracketExpressionMatch[3]}`;

    if (resolvedBindings.has(bindingKey)) {
      return resolvedBindings.get(bindingKey);
    }
  }

  const parts = splitTopLevelByPlus(trimmed);

  if (parts.length <= 1) {
    const toStringMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\.toString\(\)$/);

    if (toStringMatch && resolvedBindings.has(toStringMatch[1])) {
      return resolvedBindings.get(toStringMatch[1]);
    }

    return resolveStaticUrlExpression(trimmed, resolvedBindings, seen);
  }

  const resolvedParts = parts.map((part) =>
    resolveStaticStringExpression(part, resolvedBindings, seen),
  );

  if (resolvedParts.some((part) => part === null)) {
    return null;
  }

  return resolvedParts.join("");
}

function resolveStaticUrlExpression(expression, resolvedBindings, seen = new Set()) {
  const trimmed = unwrapParenthesizedExpression(expression);
  const constructorMatch = trimmed.match(/^(?:new\s+)?URL\b/);

  if (!constructorMatch) {
    return null;
  }

  const openParenIndex = skipTrivia(trimmed, constructorMatch[0].length);

  if (trimmed[openParenIndex] !== "(") {
    return null;
  }

  const argumentsBlock = readBalancedBlock(trimmed, openParenIndex, "(", ")");

  if (!argumentsBlock || skipTrivia(trimmed, argumentsBlock.end) !== trimmed.length) {
    return null;
  }

  const argumentExpressions = splitTopLevel(argumentsBlock.value, ",");

  if (argumentExpressions.length < 1 || argumentExpressions.length > 2) {
    return null;
  }

  const [inputExpression, baseExpression] = argumentExpressions;
  const input = resolveStaticStringExpression(inputExpression, resolvedBindings, seen);
  const base =
    typeof baseExpression === "string"
      ? resolveStaticStringExpression(baseExpression, resolvedBindings, seen)
      : undefined;

  if (input === null || (typeof baseExpression === "string" && base === null)) {
    return null;
  }

  try {
    return typeof base === "string" ? new URL(input, base).toString() : new URL(input).toString();
  } catch {
    return null;
  }
}

function resolveStaticObjectProperties(expression, resolvedBindings) {
  const trimmed = unwrapParenthesizedExpression(expression);

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  const properties = new Map();
  const entries = splitTopLevel(trimmed.slice(1, -1), ",");

  for (const entry of entries) {
    const separatorIndex = findTopLevelPropertySeparator(entry);

    if (separatorIndex === -1) {
      continue;
    }

    const propertyKey = parseObjectPropertyKey(entry.slice(0, separatorIndex));
    const propertyValue = resolveStaticStringExpression(
      entry.slice(separatorIndex + 1),
      resolvedBindings,
    );

    if (propertyKey && propertyValue !== null) {
      properties.set(propertyKey, propertyValue);
    }
  }

  return properties.size > 0 ? properties : null;
}

function collectResolvedStringBindings(content) {
  const assignments = collectVariableAssignments(content);
  const assignmentExpressions = new Map(
    assignments.map((assignment) => [assignment.name, assignment.expression]),
  );
  const resolvedBindings = new Map();
  let changed = true;

  while (changed) {
    changed = false;

    for (const [name, expression] of assignmentExpressions.entries()) {
      const resolvedExpression = resolveStaticStringExpression(expression, resolvedBindings);
      const resolvedProperties = resolveStaticObjectProperties(expression, resolvedBindings);

      if (resolvedExpression !== null && resolvedBindings.get(name) !== resolvedExpression) {
        resolvedBindings.set(name, resolvedExpression);
        changed = true;
      }

      if (resolvedProperties) {
        for (const [propertyName, propertyValue] of resolvedProperties.entries()) {
          const bindingKey = `${name}.${propertyName}`;

          if (resolvedBindings.get(bindingKey) !== propertyValue) {
            resolvedBindings.set(bindingKey, propertyValue);
            changed = true;
          }
        }
      }
    }
  }

  return resolvedBindings;
}

function buildAssignmentExpressionMap(assignments) {
  return new Map(assignments.map((assignment) => [assignment.name, assignment.expression]));
}

function readSimpleReference(expression) {
  const normalizedExpression = stripTrailingTypeOperators(
    unwrapParenthesizedExpression(expression.trim()),
  );
  const identifier = readIdentifier(normalizedExpression, 0);

  if (identifier && identifier.end === normalizedExpression.length) {
    return identifier.value;
  }

  const memberExpressionMatch = normalizedExpression.match(
    /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/,
  );

  if (memberExpressionMatch) {
    return `${memberExpressionMatch[1]}.${memberExpressionMatch[2]}`;
  }

  return null;
}

function stripTrailingTypeOperators(expression) {
  let normalizedExpression = expression.trim();
  let changed = true;

  while (changed) {
    changed = false;

    const operatorIndex = findTopLevelTypeOperatorIndex(normalizedExpression);

    if (operatorIndex !== -1) {
      normalizedExpression = normalizedExpression.slice(0, operatorIndex).trim();
      changed = true;
    }

    if (changed) {
      normalizedExpression = unwrapParenthesizedExpression(normalizedExpression.trim());
    }
  }

  return normalizedExpression;
}

function findTopLevelTypeOperatorIndex(expression) {
  let index = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(expression, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(expression, index).end;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (char === ")") {
      parenDepth -= 1;
      index += 1;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth -= 1;
      index += 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      braceDepth -= 1;
      index += 1;
      continue;
    }

    if (
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      for (const keyword of ["satisfies", "as"]) {
        if (!hasWordAt(expression, index, keyword)) {
          continue;
        }

        const previousChar = index > 0 ? expression[index - 1] : "";
        const nextChar = expression[index + keyword.length] ?? "";

        if (!/\s/.test(previousChar) || !/\s/.test(nextChar)) {
          continue;
        }

        return index;
      }
    }

    index += 1;
  }

  return -1;
}

function resolveAliasedReference(reference, assignmentExpressions, seen = new Set()) {
  if (seen.has(reference)) {
    return reference;
  }

  seen.add(reference);
  const memberExpressionMatch = reference.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\.(.+)$/);

  if (memberExpressionMatch) {
    const resolvedBase = resolveAliasedReference(
      memberExpressionMatch[1],
      assignmentExpressions,
      seen,
    );
    return `${resolvedBase}.${memberExpressionMatch[2]}`;
  }

  const expression = assignmentExpressions.get(reference);

  if (!expression) {
    return reference;
  }

  const normalizedReference = readSimpleReference(expression);

  if (!normalizedReference) {
    return reference;
  }

  return resolveAliasedReference(normalizedReference, assignmentExpressions, seen);
}

function collectAliasedBindings(assignments, seedBindings) {
  const aliasedBindings = new Set(seedBindings);
  const assignmentExpressions = buildAssignmentExpressionMap(assignments);
  let changed = true;

  while (changed) {
    changed = false;

    for (const assignment of assignments) {
      const reference = readSimpleReference(assignment.expression);

      if (!reference) {
        continue;
      }

      const normalizedReference = resolveAliasedReference(reference, assignmentExpressions);

      if (!aliasedBindings.has(normalizedReference) || aliasedBindings.has(assignment.name)) {
        continue;
      }

      aliasedBindings.add(assignment.name);
      changed = true;
    }
  }

  return [...aliasedBindings];
}

function collectIndirectImportExpressions(content) {
  const expressions = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(content, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(content, index).end;
      continue;
    }

    if (hasWordAt(content, index, "import")) {
      const openParenIndex = skipTrivia(content, index + "import".length);

      if (content[openParenIndex] === "(" && !readModuleSpecifierLiteral(content, openParenIndex + 1)) {
        expressions.push(
          readExpression(content, openParenIndex + 1, {
            stopOnParen: true,
          }).value,
        );
      }

      index += "import".length;
      continue;
    }

    if (hasWordAt(content, index, "require")) {
      const openParenIndex = skipTrivia(content, index + "require".length);

      if (content[openParenIndex] === "(" && !readModuleSpecifierLiteral(content, openParenIndex + 1)) {
        expressions.push(
          readExpression(content, openParenIndex + 1, {
            stopOnParen: true,
          }).value,
        );
      }

      index += "require".length;
      continue;
    }

    index += 1;
  }

  return expressions.filter(Boolean);
}

function readBalancedBlock(content, startIndex, openChar, closeChar) {
  let index = startIndex;
  let depth = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "'" || char === "\"") {
      index = readQuotedLiteral(content, index).end;
      continue;
    }

    if (char === "`") {
      index = readTemplateLiteral(content, index).end;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return { value: content.slice(startIndex + 1, index), end: index + 1 };
      }
    }

    index += 1;
  }

  return null;
}

function parseModuleAst(content) {
  const parsed = parseForESLint(content, {
    sourceType: "module",
    ecmaVersion: "latest",
    ecmaFeatures: { jsx: true },
    loc: true,
    range: true,
  });

  return {
    ast: parsed.ast,
    scopeManager: parsed.scopeManager,
  };
}

function getNodeText(content, node) {
  if (!node?.range) {
    return "";
  }

  return content.slice(node.range[0], node.range[1]);
}

function unwrapTypeExpressionNode(node) {
  let current = node;

  while (current) {
    if (
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSInstantiationExpression"
    ) {
      current = current.expression;
      continue;
    }

    if (current.type === "ChainExpression" || current.type === "ParenthesizedExpression") {
      current = current.expression;
      continue;
    }

    break;
  }

  return current;
}

function isFunctionLikeNode(node) {
  return node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression";
}

function formatNodeListText(nodes, content) {
  return nodes.map((node) => getNodeText(content, node)).join(", ");
}

function getDeclaredFunctionTypeParametersText(declarator, content) {
  const typeAnnotation = declarator.id.typeAnnotation?.typeAnnotation;

  if (typeAnnotation?.type !== "TSFunctionType") {
    return "";
  }

  return formatNodeListText(typeAnnotation.params, content).trim();
}

function collectAstImportBindings(ast) {
  const bindings = [];

  for (const statement of ast.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") {
      continue;
    }

    for (const specifier of statement.specifiers) {
      let importType = "named";
      let importedName = specifier.local.name;

      if (specifier.type === "ImportDefaultSpecifier") {
        importType = "default";
        importedName = "default";
      } else if (specifier.type === "ImportNamespaceSpecifier") {
        importType = "namespace";
        importedName = "*";
      } else if (specifier.imported.type === "Identifier") {
        importedName = specifier.imported.name;
      } else {
        importedName = String(specifier.imported.value);
      }

      bindings.push({
        localName: specifier.local.name,
        importedName,
        importType,
        specifier: statement.source.value,
        node: specifier,
      });
    }
  }

  return bindings;
}

function buildTopLevelBindingMap(ast, importBindings) {
  const bindings = new Map();

  for (const binding of importBindings) {
    bindings.set(binding.localName, {
      kind: "import",
      localName: binding.localName,
      sourceModule: binding.specifier,
      importType: binding.importType,
      node: binding.node,
    });
  }

  for (const statement of ast.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" && statement.declaration
        ? statement.declaration
        : statement;

    if (declaration.type === "FunctionDeclaration" && declaration.id) {
      bindings.set(declaration.id.name, {
        kind: "function",
        localName: declaration.id.name,
        node: declaration,
      });
      continue;
    }

    if (declaration.type !== "VariableDeclaration") {
      continue;
    }

    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier") {
        continue;
      }

      bindings.set(declarator.id.name, {
        kind: "variable",
        localName: declarator.id.name,
        declarationKind: declaration.kind,
        node: declarator,
      });
    }
  }

  return bindings;
}

function createHandlerRecordFromBinding(content, exportedName, binding, localNode) {
  if (!binding) {
    return null;
  }

  if (binding.kind === "import") {
    return {
      name: exportedName,
      exportedName,
      originType: "import-binding",
      localName: binding.localName,
      sourceModule: binding.sourceModule,
      importType: binding.importType,
      expressionNode: localNode ?? binding.node.local,
      declarationNode: binding.node,
      parameters: "",
      body: `return ${binding.localName};`,
    };
  }

  if (binding.kind === "function") {
    const body = getNodeText(content, binding.node.body).slice(1, -1).trim();

    return {
      name: exportedName,
      exportedName,
      originType: "local-function",
      localName: binding.localName,
      declarationNode: binding.node,
      functionNode: binding.node,
      parameters: formatNodeListText(binding.node.params, content).trim(),
      body,
    };
  }

  if (binding.kind === "variable") {
    const initNode = unwrapTypeExpressionNode(binding.node.init);
    let parameters = "";
    let body = "";

    if (isFunctionLikeNode(initNode)) {
      parameters = formatNodeListText(initNode.params, content).trim();

      if (initNode.body.type === "BlockStatement") {
        body = getNodeText(content, initNode.body).slice(1, -1).trim();
      } else {
        body = `return ${getNodeText(content, initNode.body).replace(/;+\s*$/, "")};`;
      }
    } else {
      parameters = getDeclaredFunctionTypeParametersText(binding.node, content);
      body = `return ${getNodeText(content, initNode).replace(/;+\s*$/, "")};`;
    }

    return {
      name: exportedName,
      exportedName,
      originType: "local-variable",
      localName: binding.localName,
      declarationNode: binding.node,
      initNode,
      parameters,
      body,
    };
  }

  return null;
}

function collectAstHandlerRecords(content) {
  const { ast, scopeManager } = parseModuleAst(content);
  const importBindings = collectAstImportBindings(ast);
  const bindings = buildTopLevelBindingMap(ast, importBindings);
  const records = [];

  for (const statement of ast.body) {
    if (statement.type !== "ExportNamedDeclaration") {
      continue;
    }

    if (statement.declaration?.type === "FunctionDeclaration" && statement.declaration.id) {
      const exportedName = statement.declaration.id.name;

      if (exportedName === "loader" || exportedName === "action") {
        records.push(
          createHandlerRecordFromBinding(content, exportedName, bindings.get(exportedName)),
        );
      }

      continue;
    }

    if (statement.declaration?.type === "VariableDeclaration") {
      for (const declarator of statement.declaration.declarations) {
        if (declarator.id.type !== "Identifier") {
          continue;
        }

        const exportedName = declarator.id.name;

        if (exportedName !== "loader" && exportedName !== "action") {
          continue;
        }

        records.push(
          createHandlerRecordFromBinding(content, exportedName, bindings.get(exportedName)),
        );
      }

      continue;
    }

    if (statement.source) {
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ExportSpecifier" || specifier.local.type !== "Identifier") {
        continue;
      }

      const exportedName =
        specifier.exported.type === "Identifier"
          ? specifier.exported.name
          : String(specifier.exported.value);

      if (exportedName !== "loader" && exportedName !== "action") {
        continue;
      }

      records.push(
        createHandlerRecordFromBinding(
          content,
          exportedName,
          bindings.get(specifier.local.name),
          specifier.local,
        ),
      );
    }
  }

  return {
    ast,
    scopeManager,
    importBindings,
    handlerRecords: records.filter(Boolean),
  };
}

function collectExportedRouteHandlers(content) {
  return dedupeHandlers(
    collectAstHandlerRecords(content).handlerRecords.map((record) => ({
      name: record.name,
      parameters: record.parameters,
      body: record.body,
    })),
  );
}

function dedupeHandlers(handlers) {
  const seen = new Set();
  return handlers.filter((handler) => {
    const key = `${handler.name}:${handler.parameters}:${handler.body}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function unwrapLeadingAwait(expression) {
  const trimmed = unwrapParenthesizedExpression(expression);

  if (!trimmed.startsWith("await ")) {
    return trimmed;
  }

  return unwrapLeadingAwait(trimmed.slice("await ".length));
}

function hasControlFlowOrMutation(body) {
  const executableBody = stripCommentsAndStrings(body);

  return (
    /\b(?:const|let|var|if|else|for|while|switch|case|try|catch|throw)\b|=>/.test(
      executableBody,
    ) || /(?:^|[^=!<>])=(?!=|>)/.test(executableBody)
  );
}

function isPrimitiveLiteralExpression(expression) {
  return /^(?:true|false|null|undefined|-?\d+(?:\.\d+)?)$/.test(expression);
}

function expressionLooksStatic(
  expression,
  resolvedStringBindings,
  assignmentExpressions,
  seen = new Set(),
) {
  const normalizedExpression = unwrapLeadingAwait(expression);

  if (
    resolveStaticStringExpression(normalizedExpression, resolvedStringBindings) !== null ||
    isPrimitiveLiteralExpression(normalizedExpression)
  ) {
    return true;
  }

  const identifier = readIdentifier(normalizedExpression, 0);

  if (identifier && identifier.end === normalizedExpression.length) {
    if (seen.has(identifier.value) || !assignmentExpressions.has(identifier.value)) {
      return false;
    }

    const nextSeen = new Set(seen);
    nextSeen.add(identifier.value);

    return expressionLooksStatic(
      assignmentExpressions.get(identifier.value),
      resolvedStringBindings,
      assignmentExpressions,
      nextSeen,
    );
  }

  if (normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")) {
    return splitTopLevel(normalizedExpression.slice(1, -1), ",").every((part) =>
      expressionLooksStatic(part, resolvedStringBindings, assignmentExpressions, seen),
    );
  }

  if (normalizedExpression.startsWith("{") && normalizedExpression.endsWith("}")) {
    return splitTopLevel(normalizedExpression.slice(1, -1), ",").every((entry) => {
      const trimmedEntry = entry.trim();
      const separatorIndex = findTopLevelPropertySeparator(trimmedEntry);

      if (separatorIndex === -1) {
        const shorthandIdentifier = readIdentifier(trimmedEntry, 0);

        return (
          shorthandIdentifier &&
          shorthandIdentifier.end === trimmedEntry.length &&
          expressionLooksStatic(
            trimmedEntry,
            resolvedStringBindings,
            assignmentExpressions,
            seen,
          )
        );
      }

      return expressionLooksStatic(
        trimmedEntry.slice(separatorIndex + 1),
        resolvedStringBindings,
        assignmentExpressions,
        seen,
      );
    });
  }

  return false;
}

function expressionHasDirectAdminLiteral(expression) {
  return /["'`][\s\S]*?\/admin\/api\//.test(expression);
}

function stripComments(content) {
  let result = "";
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "'" || char === "\"") {
      const stringLiteral = readQuotedLiteral(content, index);
      result += content.slice(index, stringLiteral.end);
      index = stringLiteral.end;
      continue;
    }

    if (char === "`") {
      const templateLiteral = readTemplateLiteral(content, index);
      result += content.slice(index, templateLiteral.end);
      index = templateLiteral.end;
      continue;
    }

    if (char === "/" && content[index + 1] === "/") {
      const lineCommentEnd = content.indexOf("\n", index + 2);
      const end = lineCommentEnd === -1 ? content.length : lineCommentEnd;
      result += " ".repeat(end - index);
      index = end;
      continue;
    }

    if (char === "/" && content[index + 1] === "*") {
      const blockCommentEnd = content.indexOf("*/", index + 2);
      const end = blockCommentEnd === -1 ? content.length : blockCommentEnd + 2;
      result += " ".repeat(end - index);
      index = end;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function stripCommentsAndStrings(content) {
  let result = "";
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    if (char === "/" && content[index + 1] === "/") {
      const lineCommentEnd = content.indexOf("\n", index + 2);
      const end = lineCommentEnd === -1 ? content.length : lineCommentEnd;
      result += " ".repeat(end - index);
      index = end;
      continue;
    }

    if (char === "/" && content[index + 1] === "*") {
      const blockCommentEnd = content.indexOf("*/", index + 2);
      const end = blockCommentEnd === -1 ? content.length : blockCommentEnd + 2;
      result += " ".repeat(end - index);
      index = end;
      continue;
    }

    if (char === "'" || char === "\"") {
      const stringLiteral = readQuotedLiteral(content, index);
      result += " ".repeat(stringLiteral.end - index);
      index = stringLiteral.end;
      continue;
    }

    if (char === "`") {
      const templateLiteral = readTemplateLiteral(content, index);
      result += " ".repeat(templateLiteral.end - index);
      index = templateLiteral.end;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function getReferenceLookupKey(node) {
  return node?.range ? `${node.range[0]}:${node.range[1]}` : "";
}

function buildReferenceLookup(scopeManager) {
  const lookup = new Map();

  for (const scope of scopeManager.scopes) {
    for (const reference of scope.references) {
      lookup.set(getReferenceLookupKey(reference.identifier), reference);
    }

    for (const reference of scope.through) {
      lookup.set(getReferenceLookupKey(reference.identifier), reference);
    }
  }

  return lookup;
}

function getIdentifierReference(node, referenceLookup) {
  if (!node || node.type !== "Identifier") {
    return null;
  }

  return referenceLookup.get(getReferenceLookupKey(node)) ?? null;
}

function getImportBindingInfoForIdentifier(node, referenceLookup) {
  const reference = getIdentifierReference(node, referenceLookup);
  const definition = reference?.resolved?.defs?.[0];

  if (!definition || definition.type !== "ImportBinding") {
    return null;
  }

  let importType = "named";

  if (definition.node.type === "ImportNamespaceSpecifier") {
    importType = "namespace";
  } else if (definition.node.type === "ImportDefaultSpecifier") {
    importType = "default";
  }

  return {
    localName: definition.name.name,
    importType,
    specifier: definition.parent.source.value,
  };
}

function getMemberPropertyName(node) {
  const propertyNode = unwrapTypeExpressionNode(node);

  if (propertyNode?.type === "Identifier") {
    return propertyNode.name;
  }

  if (propertyNode?.type === "Literal" && typeof propertyNode.value === "string") {
    return propertyNode.value;
  }

  return null;
}

function getAstReferencePath(node) {
  const normalizedNode = unwrapTypeExpressionNode(node);

  if (!normalizedNode) {
    return null;
  }

  if (normalizedNode.type === "Identifier") {
    return normalizedNode.name;
  }

  if (normalizedNode.type !== "MemberExpression") {
    return null;
  }

  const objectPath = getAstReferencePath(normalizedNode.object);
  const propertyName = getMemberPropertyName(normalizedNode.property);

  if (!objectPath || !propertyName) {
    return null;
  }

  return `${objectPath}.${propertyName}`;
}

function walkAst(node, visitor) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (visitor(node) === false) {
    return;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && typeof child.type === "string") {
          walkAst(child, visitor);
        }
      }

      continue;
    }

    if (value && typeof value === "object" && typeof value.type === "string") {
      walkAst(value, visitor);
    }
  }
}

function extractFunctionLikeEvaluation(functionNode, content) {
  if (functionNode.body.type !== "BlockStatement") {
    return {
      kind: "return",
      expressionNode: unwrapTypeExpressionNode(functionNode.body),
      bodyText: `return ${getNodeText(content, functionNode.body).replace(/;+\s*$/, "")};`,
    };
  }

  const bodyText = getNodeText(content, functionNode.body).slice(1, -1).trim();

  if (
    functionNode.body.body.length !== 1 ||
    functionNode.body.body[0].type !== "ReturnStatement" ||
    !functionNode.body.body[0].argument
  ) {
    return {
      kind: "statement",
      expressionNode: null,
      bodyText,
    };
  }

  return {
    kind: "return",
    expressionNode: unwrapTypeExpressionNode(functionNode.body.body[0].argument),
    bodyText,
  };
}

function extractHandlerEvaluation(record, content) {
  if (record.originType === "import-binding") {
    return {
      kind: "return",
      expressionNode: record.expressionNode,
      bodyText: record.body,
    };
  }

  if (record.originType === "local-function") {
    return extractFunctionLikeEvaluation(record.functionNode, content);
  }

  const initNode = unwrapTypeExpressionNode(record.initNode);

  if (isFunctionLikeNode(initNode)) {
    return extractFunctionLikeEvaluation(initNode, content);
  }

  return {
    kind: "return",
    expressionNode: initNode,
    bodyText: record.body,
  };
}

function resolveDelegatedCallable(node, referenceLookup, seen = new Set()) {
  const normalizedNode = unwrapTypeExpressionNode(node);

  if (!normalizedNode) {
    return null;
  }

  if (normalizedNode.type === "Identifier") {
    const importBinding = getImportBindingInfoForIdentifier(normalizedNode, referenceLookup);

    if (importBinding) {
      return {
        kind: importBinding.importType === "namespace" ? "namespace-object" : "callable-import",
        specifier: importBinding.specifier,
      };
    }

    const reference = getIdentifierReference(normalizedNode, referenceLookup);
    const definition = reference?.resolved?.defs?.[0];

    if (
      !definition ||
      definition.type !== "Variable" ||
      definition.parent.kind !== "const" ||
      definition.node.id.type !== "Identifier" ||
      !definition.node.init
    ) {
      return null;
    }

    const seenKey = `${definition.name.name}:${definition.node.range[0]}`;

    if (seen.has(seenKey)) {
      return null;
    }

    const nextSeen = new Set(seen);
    nextSeen.add(seenKey);
    return resolveDelegatedCallable(definition.node.init, referenceLookup, nextSeen);
  }

  if (normalizedNode.type !== "MemberExpression") {
    return null;
  }

  const propertyName = getMemberPropertyName(normalizedNode.property);
  const objectTarget = resolveDelegatedCallable(normalizedNode.object, referenceLookup, seen);

  if (!propertyName || !objectTarget || objectTarget.kind !== "namespace-object") {
    return null;
  }

  return {
    kind: "namespace-member",
    specifier: objectTarget.specifier,
  };
}

function expressionHasAllowedImportedCall(expressionNode, referenceLookup, targetMatcher) {
  let matched = false;

  walkAst(expressionNode, (node) => {
    if (matched) {
      return false;
    }

    if (node.type !== "CallExpression") {
      return true;
    }

    const callee = unwrapTypeExpressionNode(node.callee);
    const delegatedCallable = resolveDelegatedCallable(callee, referenceLookup);

    if (
      delegatedCallable &&
      delegatedCallable.kind !== "namespace-object" &&
      targetMatcher(delegatedCallable.specifier)
    ) {
      matched = true;
      return false;
    }

    return true;
  });

  return matched;
}

function expressionIsAllowedImportedBindingReference(record, expressionNode, referenceLookup, targetMatcher) {
  if (record.originType !== "import-binding" || expressionNode?.type !== "Identifier") {
    return false;
  }

  const importBinding = getImportBindingInfoForIdentifier(expressionNode, referenceLookup);
  return (
    importBinding !== null &&
    importBinding.importType !== "namespace" &&
    targetMatcher(importBinding.specifier)
  );
}

function expressionIsAllowedDynamicImport(expressionNode, content, resolvedStringBindings, targetMatcher) {
  let candidate = unwrapTypeExpressionNode(expressionNode);

  if (candidate?.type === "AwaitExpression") {
    candidate = unwrapTypeExpressionNode(candidate.argument);
  }

  if (candidate?.type !== "ImportExpression") {
    return false;
  }

  const resolvedSpecifier = resolveStaticStringExpression(
    getNodeText(content, candidate.source),
    resolvedStringBindings,
  );

  return resolvedSpecifier !== null && targetMatcher(resolvedSpecifier);
}

function extractObjectStyleRequestUrl(argumentNode) {
  const normalizedArgument = unwrapTypeExpressionNode(argumentNode);

  if (!normalizedArgument || normalizedArgument.type !== "ObjectExpression") {
    return null;
  }

  for (const property of normalizedArgument.properties) {
    if (
      property.type !== "Property" ||
      property.kind !== "init" ||
      property.method ||
      property.shorthand
    ) {
      continue;
    }

    if (getMemberPropertyName(property.key) === "url") {
      return unwrapTypeExpressionNode(property.value);
    }
  }

  return null;
}

function extractRequestUrlExpression(node, objectStyleCallables, memberObjectNames) {
  const calleePath = getAstReferencePath(node.callee);

  if (calleePath && objectStyleCallables.has(calleePath)) {
    return extractObjectStyleRequestUrl(node.arguments[0]);
  }

  if (calleePath) {
    return node.arguments[0] ?? null;
  }

  if (node.callee?.type !== "MemberExpression") {
    return null;
  }

  const objectPath = getAstReferencePath(node.callee.object);
  const propertyName = getMemberPropertyName(node.callee.property);

  if (!objectPath || !propertyName || !memberObjectNames.has(objectPath)) {
    return null;
  }

  if (propertyName === "request") {
    return extractObjectStyleRequestUrl(node.arguments[0]);
  }

  if (["get", "post", "put", "patch", "delete"].includes(propertyName)) {
    return node.arguments[0] ?? null;
  }

  return null;
}

function collectRequestUrlExpressionsAst(ast, requestCallableNames, objectStyleCallables, memberObjectNames) {
  const expressions = [];

  walkAst(ast, (node) => {
    if (node.type !== "CallExpression" && node.type !== "NewExpression") {
      return true;
    }

    const calleePath = getAstReferencePath(node.callee);
    const memberObjectPath =
      node.callee.type === "MemberExpression" ? getAstReferencePath(node.callee.object) : null;

    if (
      !calleePath ||
      (!requestCallableNames.has(calleePath) && !memberObjectNames.has(memberObjectPath))
    ) {
      return true;
    }

    const urlExpression = extractRequestUrlExpression(
      node,
      objectStyleCallables,
      memberObjectNames,
    );

    if (urlExpression) {
      expressions.push(urlExpression);
    }

    return true;
  });

  return expressions;
}

function resolveStaticStringFromAst(node, content, referenceLookup, seen = new Set()) {
  const normalizedNode = unwrapTypeExpressionNode(node);

  if (!normalizedNode) {
    return null;
  }

  if (normalizedNode.type === "Literal" && typeof normalizedNode.value === "string") {
    return normalizedNode.value;
  }

  if (normalizedNode.type === "TemplateLiteral") {
    let value = "";

    for (let index = 0; index < normalizedNode.quasis.length; index += 1) {
      value += normalizedNode.quasis[index].value.cooked ?? "";

      if (normalizedNode.expressions[index]) {
        const resolvedExpression = resolveStaticStringFromAst(
          normalizedNode.expressions[index],
          content,
          referenceLookup,
          seen,
        );

        if (resolvedExpression === null) {
          return null;
        }

        value += resolvedExpression;
      }
    }

    return value;
  }

  if (normalizedNode.type === "BinaryExpression" && normalizedNode.operator === "+") {
    const left = resolveStaticStringFromAst(normalizedNode.left, content, referenceLookup, seen);
    const right = resolveStaticStringFromAst(normalizedNode.right, content, referenceLookup, seen);
    return left === null || right === null ? null : left + right;
  }

  if (normalizedNode.type === "Identifier") {
    const reference = getIdentifierReference(normalizedNode, referenceLookup);
    const definition = reference?.resolved?.defs?.[0];

    if (
      !definition ||
      definition.type !== "Variable" ||
      definition.parent.kind !== "const" ||
      definition.node.id.type !== "Identifier" ||
      !definition.node.init
    ) {
      return null;
    }

    const seenKey = `${definition.name.name}:${definition.node.range[0]}`;

    if (seen.has(seenKey)) {
      return null;
    }

    const nextSeen = new Set(seen);
    nextSeen.add(seenKey);
    return resolveStaticStringFromAst(definition.node.init, content, referenceLookup, nextSeen);
  }

  if (normalizedNode.type === "MemberExpression") {
    const propertyName = getMemberPropertyName(normalizedNode.property);

    if (!propertyName) {
      return null;
    }

    if (propertyName === "href") {
      return resolveStaticStringFromAst(normalizedNode.object, content, referenceLookup, seen);
    }

    const objectNode = unwrapTypeExpressionNode(normalizedNode.object);

    if (objectNode?.type === "ObjectExpression") {
      for (const property of objectNode.properties) {
        if (
          property.type === "Property" &&
          property.kind === "init" &&
          !property.method &&
          getMemberPropertyName(property.key) === propertyName
        ) {
          return resolveStaticStringFromAst(property.value, content, referenceLookup, seen);
        }
      }

      return null;
    }

    if (objectNode?.type !== "Identifier") {
      return null;
    }

    const reference = getIdentifierReference(objectNode, referenceLookup);
    const definition = reference?.resolved?.defs?.[0];

    if (
      !definition ||
      definition.type !== "Variable" ||
      definition.parent.kind !== "const" ||
      definition.node.id.type !== "Identifier" ||
      !definition.node.init
    ) {
      return null;
    }

    const initNode = unwrapTypeExpressionNode(definition.node.init);

    if (initNode?.type !== "ObjectExpression") {
      return null;
    }

    for (const property of initNode.properties) {
      if (
        property.type === "Property" &&
        property.kind === "init" &&
        !property.method &&
        getMemberPropertyName(property.key) === propertyName
      ) {
        return resolveStaticStringFromAst(property.value, content, referenceLookup, seen);
      }
    }

    return null;
  }

  if (
    normalizedNode.type === "CallExpression" &&
    normalizedNode.arguments.length === 0 &&
    normalizedNode.callee.type === "MemberExpression"
  ) {
    const propertyName = getMemberPropertyName(normalizedNode.callee.property);

    if (propertyName === "toString") {
      return resolveStaticStringFromAst(
        normalizedNode.callee.object,
        content,
        referenceLookup,
        seen,
      );
    }
  }

  if (
    normalizedNode.type === "NewExpression" &&
    normalizedNode.callee.type === "Identifier" &&
    normalizedNode.callee.name === "URL" &&
    normalizedNode.arguments.length >= 1 &&
    normalizedNode.arguments.length <= 2
  ) {
    const input = resolveStaticStringFromAst(
      normalizedNode.arguments[0],
      content,
      referenceLookup,
      seen,
    );
    const base =
      normalizedNode.arguments[1] === undefined
        ? undefined
        : resolveStaticStringFromAst(
            normalizedNode.arguments[1],
            content,
            referenceLookup,
            seen,
          );

    if (input === null || (normalizedNode.arguments[1] !== undefined && base === null)) {
      return null;
    }

    try {
      return typeof base === "string" ? new URL(input, base).toString() : new URL(input).toString();
    } catch {
      return null;
    }
  }

  return null;
}

function scanSource(content) {
  const commentStrippedContent = stripComments(content);
  const astAnalysis = collectAstHandlerRecords(content);
  const variableAssignments = collectVariableAssignments(commentStrippedContent);
  const resolvedStringBindings = collectResolvedStringBindings(commentStrippedContent);
  const assignmentExpressions = buildAssignmentExpressionMap(variableAssignments);
  const requestCallableNames = collectAliasedBindings(variableAssignments, [
    "fetch",
    "Request",
    "globalThis.fetch",
    "globalThis.Request",
    "window.fetch",
    "window.Request",
    "self.fetch",
    "self.Request",
    "global.fetch",
    "global.Request",
    "axios.get",
    "axios.post",
    "axios.put",
    "axios.patch",
    "axios.delete",
    "axios.request",
  ]);
  const requestMemberObjectNames = collectAliasedBindings(variableAssignments, ["axios"]);
  const requestObjectStyleCallables = new Set(
    requestCallableNames.filter((bindingName) =>
      resolveAliasedReference(bindingName, assignmentExpressions).endsWith(".request"),
    ),
  );
  const literalImports = readImportSpecifiers(content);
  const indirectImports = collectIndirectImportExpressions(commentStrippedContent)
    .map((expression) => resolveStaticStringExpression(expression, resolvedStringBindings))
    .filter(Boolean);

  return {
    content,
    commentStrippedContent,
    executableContent: stripCommentsAndStrings(content),
    variableAssignments,
    resolvedStringBindings,
    requestUrlExpressions: collectRequestUrlExpressionsAst(
      astAnalysis.ast,
      new Set(requestCallableNames),
      requestObjectStyleCallables,
      new Set(requestMemberObjectNames),
    ),
    importBindings: astAnalysis.importBindings,
    routeHandlers: astAnalysis.handlerRecords.map((record) => ({
      name: record.name,
      parameters: record.parameters,
      body: record.body,
    })),
    handlerRecords: astAnalysis.handlerRecords,
    referenceLookup: buildReferenceLookup(astAnalysis.scopeManager),
    imports: [...new Set([...literalImports, ...indirectImports])],
  };
}

function isRouteFile(relativePath) {
  const segments = normalizePath(relativePath).split("/");

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === "app" && segments[index + 1] === "routes") {
      return true;
    }
  }

  return segments[0] === "routes";
}

function isWebhookRouteFile(relativePath) {
  if (!isRouteFile(relativePath)) {
    return false;
  }

  const normalizedPath = normalizePath(relativePath);
  const routeRootPattern = /(?:^|\/)app\/routes\//;
  const nestedRoutePath = routeRootPattern.test(normalizedPath)
    ? normalizedPath.replace(/^.*app\/routes\//, "")
    : normalizedPath.replace(/^routes\//, "");
  const routeStem = nestedRoutePath.replace(/\.[cm]?[jt]sx?$/, "");
  const webhookFolderPrefix = "webhooks/";

  if (routeStem.startsWith("webhooks.")) {
    const flatWebhookStem = routeStem.slice("webhooks.".length);
    return flatWebhookStem.length > 0 && flatWebhookStem !== "_index";
  }

  if (!routeStem.startsWith(webhookFolderPrefix)) {
    return false;
  }

  const nestedWebhookStem = routeStem.slice(webhookFolderPrefix.length);
  return nestedWebhookStem.length > 0 && nestedWebhookStem !== "index" && nestedWebhookStem !== "_index";
}

function isPlatformShopifyFile(relativePath) {
  return /(^|\/)platform\/shopify(?:[./]|$)/.test(normalizePath(relativePath));
}

function isGuardrailImplementationFile(relativePath) {
  return normalizePath(relativePath) === "scripts/check-architecture-guardrails.mjs";
}

function matchesModuleFamily(specifier, modulePath) {
  if (!specifier.startsWith(modulePath)) {
    return false;
  }

  if (specifier === modulePath) {
    return true;
  }

  const nextChar = specifier[modulePath.length];
  return nextChar === "/" || nextChar === ".";
}

function normalizeSpecifier(specifier) {
  if (specifier.startsWith("~/")) {
    return `~/${path.posix.normalize(specifier.slice(2))}`;
  }

  return path.posix.normalize(specifier);
}

function importTargetsDomain(specifier) {
  const normalizedSpecifier = normalizeSpecifier(specifier);

  return (
    /(^|\/)domain(?:[./]|$)/.test(normalizedSpecifier) ||
    matchesModuleFamily(normalizedSpecifier, "~/domain")
  );
}

function importTargetsPlatformShopify(specifier) {
  const normalizedSpecifier = normalizeSpecifier(specifier);

  return (
    /(^|\/)platform\/shopify(?:[./]|$)/.test(normalizedSpecifier) ||
    matchesModuleFamily(normalizedSpecifier, "~/platform/shopify")
  );
}

function importTargetsAppServices(specifier) {
  const normalizedSpecifier = normalizeSpecifier(specifier);

  return (
    /(^|\/)app\/services(?:[./]|$)/.test(normalizedSpecifier) ||
    matchesModuleFamily(normalizedSpecifier, "~/app/services")
  );
}

function importTargetsNonWebhookDomain(specifier) {
  const normalizedSpecifier = normalizeSpecifier(specifier);

  if (!importTargetsDomain(normalizedSpecifier)) {
    return false;
  }

  return (
    !/(^|\/)domain\/webhooks(?:[./]|$)/.test(normalizedSpecifier) &&
    !matchesModuleFamily(normalizedSpecifier, "~/domain/webhooks")
  );
}

function evaluateFile(relativePath, source) {
  const {
    content,
    executableContent,
    imports,
    variableAssignments,
    resolvedStringBindings,
    handlerRecords,
    referenceLookup,
    requestUrlExpressions,
  } = source;
  const assignmentExpressions = buildAssignmentExpressionMap(variableAssignments);
  const violations = [];

  if (isRouteFile(relativePath)) {
    for (const specifier of imports) {
      if (!isWebhookRouteFile(relativePath) && importTargetsDomain(specifier)) {
        violations.push({
          code: "route-service-boundary",
          message: "routes must call app/services and must not import domain modules directly",
        });
      }

      if (importTargetsPlatformShopify(specifier)) {
        violations.push({
          code: "no-direct-admin-api-access",
          message: "routes must not import platform/shopify directly; go through app/services",
        });
      }
    }
  }

  if (!isPlatformShopifyFile(relativePath) && !isGuardrailImplementationFile(relativePath)) {
    for (const specifier of imports) {
      if (directAdminModuleSpecifiers.includes(specifier)) {
        violations.push({
          code: "no-direct-admin-api-access",
          message: `direct Shopify Admin API module detected: ${specifier}`,
        });
      }
    }

    for (const token of directAdminCodeTokens) {
      if (executableContent.includes(token)) {
        violations.push({
          code: "no-direct-admin-api-access",
          message: `direct Shopify Admin API token detected: ${token}`,
        });
      }
    }

    if (
      requestUrlExpressions.some((expressionNode) => {
        const expressionText = getNodeText(content, expressionNode);
        const resolvedExpression =
          resolveStaticStringFromAst(expressionNode, content, referenceLookup) ??
          resolveStaticStringExpression(expressionText, resolvedStringBindings);

        return (
          expressionHasDirectAdminLiteral(expressionText) ||
          resolvedExpression?.includes("/admin/api/")
        );
      })
    ) {
      violations.push({
        code: "no-direct-admin-api-access",
        message: "direct Shopify Admin API request detected via /admin/api/ request construction",
      });
    }
  }

  if (isWebhookRouteFile(relativePath)) {
    for (const specifier of imports) {
      if (importTargetsNonWebhookDomain(specifier)) {
        violations.push({
          code: "no-webhook-inline-business-logic",
          message: "webhook routes must enqueue via domain/webhooks and must not import other domain logic",
        });
      }
    }
  }

  if (isRouteFile(relativePath)) {
    const webhookTargetMatcher = (specifier) =>
      !importTargetsNonWebhookDomain(specifier) && importTargetsDomain(specifier);

    for (const handler of handlerRecords) {
      const evaluatedHandler = extractHandlerEvaluation(handler, content);
      const expressionText = evaluatedHandler.expressionNode
        ? getNodeText(content, evaluatedHandler.expressionNode)
        : "";
      const hasServiceDelegation =
        expressionIsAllowedImportedBindingReference(
          handler,
          evaluatedHandler.expressionNode,
          referenceLookup,
          importTargetsAppServices,
        ) ||
        expressionIsAllowedDynamicImport(
          evaluatedHandler.expressionNode,
          content,
          resolvedStringBindings,
          importTargetsAppServices,
        ) ||
        expressionHasAllowedImportedCall(
          evaluatedHandler.expressionNode,
          referenceLookup,
          importTargetsAppServices,
        );
      const hasWebhookDelegation =
        expressionIsAllowedImportedBindingReference(
          handler,
          evaluatedHandler.expressionNode,
          referenceLookup,
          webhookTargetMatcher,
        ) ||
        expressionIsAllowedDynamicImport(
          evaluatedHandler.expressionNode,
          content,
          resolvedStringBindings,
          webhookTargetMatcher,
        ) ||
        expressionHasAllowedImportedCall(
          evaluatedHandler.expressionNode,
          referenceLookup,
          webhookTargetMatcher,
        );

      if (isWebhookRouteFile(relativePath)) {
        if (
          evaluatedHandler.kind !== "return" ||
          hasControlFlowOrMutation(evaluatedHandler.bodyText) ||
          !hasWebhookDelegation
        ) {
          violations.push({
            code: "no-webhook-inline-business-logic",
            message: "webhook routes must enqueue via domain/webhooks and must not keep business logic inline",
          });
        }

        continue;
      }

      if (
        evaluatedHandler.kind !== "return" ||
        hasControlFlowOrMutation(evaluatedHandler.bodyText)
      ) {
        violations.push({
          code: "route-service-boundary",
          message: "route handlers must stay thin and delegate business logic through app/services",
        });
        continue;
      }

      if (
        hasServiceDelegation ||
        expressionLooksStatic(
          expressionText,
          resolvedStringBindings,
          assignmentExpressions,
        )
      ) {
        continue;
      }

      violations.push({
        code: "route-service-boundary",
        message: "route handlers must stay thin and delegate business logic through app/services",
      });
    }
  }

  return dedupeViolations(violations);
}

function dedupeViolations(violations) {
  const seen = new Set();
  return violations.filter((violation) => {
    const key = `${violation.code}:${violation.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function scanRoot(root) {
  const absoluteRoot = path.join(projectRoot, root);
  const files = await listFiles(absoluteRoot);
  const violations = [];

  for (const filePath of files) {
    const relativePath = normalizePath(path.relative(projectRoot, filePath));
    const source = await readImports(filePath);
    const fileViolations = evaluateFile(relativePath, source);

    for (const violation of fileViolations) {
      violations.push({ ...violation, file: relativePath });
    }
  }

  return violations;
}

function formatViolations(violations) {
  return violations
    .map((violation) => `${violation.code}: ${violation.file} - ${violation.message}`)
    .join("\n");
}

function assertFixtureOutcome(name, violations, expectedCodes) {
  const actualCodes = [...new Set(violations.map((violation) => violation.code))].sort();
  const sortedExpected = [...expectedCodes].sort();

  if (JSON.stringify(actualCodes) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${name} failed\nexpected: ${sortedExpected.join(", ") || "(none)"}\nactual: ${actualCodes.join(", ") || "(none)"}\n${formatViolations(violations)}`,
    );
  }
}

async function runFixtureSmoke() {
  for (const fixtureCase of fixtureCases) {
    const violations = await scanRoot(fixtureCase.root);
    assertFixtureOutcome(fixtureCase.name, violations, fixtureCase.expectedCodes);
  }
}

async function runRepoScan() {
  const repoRoots = ["app", "routes", "ui", "domain", "platform", "workers", "scripts"];
  const violations = [];

  for (const root of repoRoots) {
    violations.push(...(await scanRoot(root)));
  }

  return violations;
}

async function main() {
  await runFixtureSmoke();
  const repoViolations = await runRepoScan();

  if (repoViolations.length > 0) {
    console.error("Architecture guardrail violations detected:");
    console.error(formatViolations(repoViolations));
    process.exitCode = 1;
    return;
  }

  console.log("Architecture guardrails passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export {
  collectAliasedBindings,
  collectExportedRouteHandlers,
  collectResolvedStringBindings,
  collectVariableAssignments,
  isDeclarationFile,
  isSourceFile,
  isWebhookRouteFile,
  readSimpleReference,
  resolveStaticStringExpression,
  runFixtureSmoke,
  runRepoScan,
  stripTrailingTypeOperators,
};
