#!/usr/bin/env node
/**
 * Atlas verification runner.
 *
 * Runs the repository's check workflow (typecheck, lint, generated DB types,
 * tests, production build) and prints a compact, token-efficient summary.
 * Full output is written to `.agent-logs/<timestamp>/` so an agent can read a
 * single log file instead of re-running a command or scraping a huge transcript.
 *
 * Usage:
 *   node scripts/agent/check.mjs
 *   node scripts/agent/check.mjs --only typecheck,lint
 *   node scripts/agent/check.mjs --only test --test tests/conversation-diff.test.ts
 *   node scripts/agent/check.mjs --json
 *
 * Run `--help` for every option.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const IS_WINDOWS = process.platform === "win32";
const PNPM = IS_WINDOWS ? "pnpm.cmd" : "pnpm";
const STEP_ORDER = ["typecheck", "lint", "db:types", "test", "build"];
const STEP_ALIASES = {
  types: "db:types",
  db: "db:types",
  dbtypes: "db:types",
  "db-types": "db:types",
  "db:types:check": "db:types",
};
const DEFAULT_MAX_LINES = 12;
const DEFAULT_TIMEOUT_SECONDS = 900;
const KEEP_LOG_RUNS = 10;

// The runner uses a shell on Windows so pnpm.cmd resolves. Arguments are
// controlled by this script; suppress Node's generic shell warning.
process.noDeprecation = true;

const HELP = `Atlas verification runner

Runs: typecheck, lint, db:types:check, test, build.
Stops before "build" when an earlier step fails (use --all to override).

Options:
  --only <steps>      Comma-separated subset: ${STEP_ORDER.join(", ")}
  --skip <steps>      Comma-separated steps to skip
  --test <pattern>    Run only matching Vitest files in the test step
  --json              Print a compact JSON summary instead of text
  --quiet             Omit the header and log paths
  --full              Print the full captured output for each step
  --fail-fast         Stop after the first failing step
  --all               Run every selected step, including build after failures
  --max-lines <n>     Max failure lines printed per step (default ${DEFAULT_MAX_LINES})
  --timeout <s>       Per-step timeout in seconds (default ${DEFAULT_TIMEOUT_SECONDS})
  --logs-dir <path>   Log directory (default .agent-logs)
  --no-prune          Keep more than the last ${KEEP_LOG_RUNS} log runs
  --help              Show this help

Examples:
  pnpm verify:agent
  pnpm verify:fast
  pnpm verify:json
  node scripts/agent/check.mjs --only test --test tests/conversation-diff.test.ts
`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

function parseList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeStep(name) {
  const key = name.toLowerCase();
  return STEP_ALIASES[key] ?? key;
}

function parseArgs(argv) {
  const options = {
    only: null,
    skip: [],
    json: false,
    quiet: false,
    full: false,
    failFast: false,
    all: false,
    maxLines: DEFAULT_MAX_LINES,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    logsDir: path.join(ROOT, ".agent-logs"),
    prune: true,
    testPattern: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail(`unexpected argument "${argument}"`);

    const [name, inline] = argument.slice(2).split(/=(.*)/s);
    const value = () => {
      if (inline !== undefined) return inline;
      index += 1;
      if (argv[index] === undefined) fail(`--${name} needs a value`);
      return argv[index];
    };

    switch (name) {
      case "only":
        options.only = parseList(value()).map(normalizeStep);
        break;
      case "skip":
        options.skip.push(...parseList(value()).map(normalizeStep));
        break;
      case "test":
        options.testPattern = value();
        if (/[\s&|<>^"]/.test(options.testPattern)) {
          fail("--test pattern must not contain spaces or shell metacharacters");
        }
        break;
      case "json":
        options.json = true;
        break;
      case "quiet":
        options.quiet = true;
        break;
      case "full":
        options.full = true;
        break;
      case "fail-fast":
        options.failFast = true;
        break;
      case "all":
        options.all = true;
        break;
      case "max-lines": {
        const parsed = Number(value());
        if (!Number.isSafeInteger(parsed) || parsed < 0) fail("--max-lines must be a non-negative integer");
        options.maxLines = parsed;
        break;
      }
      case "timeout": {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed <= 0) fail("--timeout must be a positive number of seconds");
        options.timeoutSeconds = parsed;
        break;
      }
      case "logs-dir":
        options.logsDir = path.resolve(ROOT, value());
        break;
      case "no-prune":
        options.prune = false;
        break;
      case "help":
      case "h":
        options.help = true;
        break;
      default:
        fail(`unknown option --${name}`);
    }
  }

  for (const step of [...(options.only ?? []), ...options.skip]) {
    if (!STEP_ORDER.includes(step)) {
      fail(`unknown step "${step}". Valid steps: ${STEP_ORDER.join(", ")}`);
    }
  }

  return options;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

function oneLine(value, max = 220) {
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function relativePath(value) {
  const normalized = String(value).split("\\").join("/");
  if (!path.isAbsolute(normalized)) return normalized;
  const relative = path.relative(ROOT, normalized).split(path.sep).join("/");
  return relative.startsWith("..") ? normalized : relative;
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function firstMeaningfulLine(value) {
  const lines = stripAnsi(String(value))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? oneLine(lines[0], 200) : "";
}

function timestampForDirectory() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function pruneLogs(logsDir) {
  if (!existsSync(logsDir)) return;
  const directories = readdirSync(logsDir).filter((name) => {
    try {
      return statSync(path.join(logsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });
  directories
    .sort()
    .reverse()
    .slice(KEEP_LOG_RUNS)
    .forEach((name) => rmSync(path.join(logsDir, name), { recursive: true, force: true }));
}

function parseTypecheck(output, maxLines) {
  const failures = [];
  const seen = new Set();
  const located = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
  const unlocated = /^(.+?): error (TS\d+): (.*)$/;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const locatedMatch = located.exec(line);
    if (locatedMatch) {
      const [, file, lineNumber, column, code, message] = locatedMatch;
      const key = `${file}:${lineNumber}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(`${relativePath(file)}:${lineNumber}:${column} ${code} ${oneLine(message)}`);
      continue;
    }

    const unlocatedMatch = unlocated.exec(line);
    if (unlocatedMatch) {
      const [, file, code, message] = unlocatedMatch;
      const key = `${file}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(`${relativePath(file)} ${code} ${oneLine(message)}`);
    }
  }

  const summary = failures.length
    ? `${failures.length} error${failures.length === 1 ? "" : "s"}`
    : "failed";
  return {
    summary,
    failures: failures.slice(0, maxLines),
    failureCount: failures.length,
  };
}

function parseLint(output, maxLines) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const files = JSON.parse(output.slice(start, end + 1));
      if (Array.isArray(files)) {
        let errors = 0;
        let warnings = 0;
        const failures = [];
        for (const file of files) {
          for (const message of file.messages ?? []) {
            if (message.severity === 2) errors += 1;
            else warnings += 1;
            if (message.severity === 2) {
              failures.push(
                `${relativePath(file.filePath)}:${message.line ?? 0}:${message.column ?? 0} ` +
                  `${message.ruleId ?? "eslint"} ${oneLine(message.message)}`,
              );
            }
          }
        }
        const parts = [];
        if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
        if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
        return {
          summary: parts.join(", ") || "ok",
          failures: failures.slice(0, maxLines),
          failureCount: errors,
        };
      }
    } catch {
      // Fall through to text parsing when a wrapper prints extra output.
    }
  }

  const failures = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\b(error|warning)\b/.test(line))
    .map((line) => oneLine(line));
  return {
    summary: "failed",
    failures: failures.slice(0, maxLines),
    failureCount: failures.length,
  };
}

function parseDbTypes(output, maxLines) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const stale = lines.find((line) => /stale/i.test(line));
  if (stale) {
    return {
      summary: "generated types are stale",
      failures: [oneLine(stale)],
      failureCount: 1,
    };
  }

  const relevant = lines
    .filter((line) => /error|fail|mismatch|missing|unexpected|extra/i.test(line))
    .map((line) => oneLine(line));
  const fallback = lines.slice(-5).map((line) => oneLine(line));
  const displayed = relevant.length ? relevant.slice(-maxLines) : fallback;
  return {
    summary: "failed",
    failures: displayed,
    failureCount: relevant.length || fallback.length,
  };
}

function parseTest(step, output, maxLines) {
  const jsonPath = step.artifacts?.[0];
  if (jsonPath && existsSync(jsonPath)) {
    try {
      const report = JSON.parse(readFileSync(jsonPath, "utf8"));
      const failures = [];
      for (const suite of report.testResults ?? []) {
        for (const test of suite.assertionResults ?? []) {
          if (test.status !== "failed") continue;
          const name = oneLine(test.fullName || test.title || suite.name || "unknown test", 160);
          const detail = firstMeaningfulLine((test.failureMessages ?? [])[0] ?? "");
          failures.push(detail ? `${name} — ${detail}` : name);
        }
      }
      const total = report.numTotalTests ?? 0;
      const passed = report.numPassedTests ?? 0;
      const failed = report.numFailedTests ?? 0;
      const pending = report.numPendingTests ?? 0;
      const summary =
        `${failed} failed / ${passed} passed (${total})` + (pending ? `, ${pending} pending` : "");
      return { summary, failures: failures.slice(0, maxLines), failureCount: failures.length };
    } catch {
      // Fall through to text parsing.
    }
  }

  const lines = output.split("\n").map((line) => line.trim());
  const failures = lines
    .filter((line) => /^FAIL\b/.test(line))
    .map((line) => oneLine(line));
  const summaryLine = lines.find((line) => /^Tests\s+/.test(line));
  return {
    summary: summaryLine ? oneLine(summaryLine) : "failed",
    failures: failures.slice(0, maxLines),
    failureCount: failures.length,
  };
}

function parseBuild(output, maxLines) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const signals = lines.filter((line) =>
    /failed to compile|type error|build error|module not found|error TS\d+|failed to build|error:/i.test(
      line,
    ),
  );
  const unique = [...new Set(signals.map((line) => oneLine(line)))];
  const displayed = unique.length ? unique.slice(0, maxLines) : lines.slice(-10).map((line) => oneLine(line));
  return {
    summary: unique.length ? `${unique.length} error line${unique.length === 1 ? "" : "s"}` : "failed",
    failures: displayed,
    failureCount: unique.length || displayed.length,
  };
}

function makeSteps(options, runDirectory) {
  const vitestReport = path.join(runDirectory, "vitest.json").split("\\").join("/");
  const testArgs = ["run", "test"];
  if (options.testPattern) testArgs.push(options.testPattern);
  testArgs.push("--reporter=json", `--outputFile=${vitestReport}`);

  return [
    { id: "typecheck", label: "typecheck", kind: "typecheck", args: ["run", "typecheck"] },
    {
      id: "lint",
      label: "lint",
      kind: "lint",
      args: ["run", "lint", "--format", "json"],
    },
    {
      id: "db:types",
      label: "db:types:check",
      kind: "db:types",
      args: ["run", "db:types:check"],
    },
    {
      id: "test",
      label: "test",
      kind: "test",
      args: testArgs,
      artifacts: [vitestReport],
    },
    { id: "build", label: "build", kind: "build", args: ["run", "build"] },
  ];
}

function parseStep(step, output, options) {
  switch (step.kind) {
    case "typecheck":
      return parseTypecheck(output, options.maxLines);
    case "lint":
      return parseLint(output, options.maxLines);
    case "db:types":
      return parseDbTypes(output, options.maxLines);
    case "test":
      return parseTest(step, output, options.maxLines);
    case "build":
      return parseBuild(output, options.maxLines);
    default:
      return { summary: "failed", failures: [] };
  }
}

function runStep(step, options, runDirectory) {
  const startedAt = Date.now();
  const result = spawnSync(PNPM, step.args, {
    cwd: ROOT,
    shell: IS_WINDOWS,
    timeout: options.timeoutSeconds * 1000,
    maxBuffer: 50 * 1024 * 1024,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      // Skip pnpm's dependency check before every script; the runner assumes
      // `pnpm install` has already been run.
      npm_config_verify_deps_before_run: "false",
    },
  });
  const durationMs = Date.now() - startedAt;
  const output = stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).trim();
  const timedOut = result.error?.code === "ETIMEDOUT";
  const exitCode = timedOut ? 124 : (result.status ?? 1);
  const logPath = path.join(runDirectory, `${step.id.replaceAll(":", "-")}.log`);
  writeFileSync(logPath, `${output}\n`, "utf8");

  const parsed = parseStep(step, output, options);
  const spawnError = result.error && !timedOut ? oneLine(result.error.message) : null;
  const failures = [...parsed.failures];
  if (timedOut) failures.unshift(`timed out after ${options.timeoutSeconds}s`);
  if (spawnError) failures.unshift(spawnError);

  let summary = exitCode === 0 ? "ok" : parsed.summary;
  let failureCount =
    (parsed.failureCount ?? parsed.failures.length) + (timedOut ? 1 : 0) + (spawnError ? 1 : 0);
  if (exitCode !== 0 && summary === "ok") summary = "failed";
  if (exitCode !== 0 && failures.length === 0) {
    const tail = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-3)
      .map((line) => oneLine(line));
    failures.push(...(tail.length ? tail : [`command exited with code ${exitCode}; see log`]));
    failureCount = failures.length;
  }

  return {
    id: step.id,
    label: step.label,
    status: exitCode === 0 ? "pass" : "fail",
    exitCode,
    durationMs,
    summary,
    failureCount,
    failures,
    log: relativePath(logPath),
    ...(step.artifacts ? { artifacts: step.artifacts.map((artifact) => relativePath(artifact)) } : {}),
  };
}

function skippedStep(step) {
  return {
    id: step.id,
    label: step.label,
    status: "skip",
    exitCode: null,
    durationMs: 0,
    summary: "blocked by an earlier failure",
    failureCount: 0,
    failures: [],
    log: null,
  };
}

function buildSummary(options, runDirectory, results, startedAt) {
  const failedSteps = results.filter((result) => result.status === "fail").length;
  const failureCount = results.reduce(
    (total, result) => total + (result.failureCount ?? result.failures.length),
    0,
  );
  const shownFailures = results.reduce((total, result) => total + result.failures.length, 0);
  const finishedAt = new Date().toISOString();
  return {
    ok: failedSteps === 0,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    cwd: ROOT,
    platform: process.platform,
    node: process.version,
    steps: results,
    counts: {
      steps: results.length,
      failedSteps,
      failures: failureCount,
      shownFailures,
    },
    logsDir: relativePath(runDirectory),
    summaryPath: relativePath(path.join(runDirectory, "summary.json")),
  };
}

function renderText(summary, options) {
  const lines = [];
  if (!options.quiet) {
    lines.push(`Atlas verification — ${summary.startedAt}`);
    lines.push(`${summary.node} · ${summary.platform}`);
    lines.push("");
  }

  for (const result of summary.steps) {
    const status = result.status.toUpperCase().padEnd(4);
    const duration = result.status === "skip" ? "" : formatDuration(result.durationMs);
    const detail = result.status === "fail" ? result.summary : "";
    lines.push(`  ${status}  ${result.label.padEnd(14)} ${duration.padEnd(7)} ${detail}`.trimEnd());
  }

  const failures = summary.steps.flatMap((result) =>
    result.failures.map((failure) => ({ step: result.label, failure })),
  );
  if (failures.length) {
    const totalFailures = summary.counts.failures;
    const label =
      failures.length === totalFailures
        ? `Failures (${totalFailures}):`
        : `Failures (${failures.length} shown of ${totalFailures}):`;
    lines.push("", label);
    for (const { step, failure } of failures) lines.push(`  [${step}] ${failure}`);
  }

  const failed = new Set(
    summary.steps.filter((result) => result.status === "fail").map((result) => result.id),
  );
  const hints = [];
  if (failed.has("typecheck")) hints.push("typecheck: fix type errors first; build will also fail.");
  if (failed.has("db:types")) hints.push("db:types: run `pnpm db:types` and commit the regenerated file.");
  if (failed.has("test")) {
    hints.push(
      "test: rerun one file with `pnpm verify:agent --only test --test <file>` or `pnpm exec vitest run <file>`.",
    );
  }
  if (hints.length) {
    lines.push("", "Hints:");
    for (const hint of hints) lines.push(`  ${hint}`);
  }

  if (!options.quiet) {
    lines.push("", `Logs: ${summary.logsDir}`);
    lines.push(`JSON: ${summary.summaryPath}`);
  }
  lines.push(
    "",
    `Result: ${summary.ok ? "PASS" : "FAIL"} (${summary.counts.failedSteps} of ${summary.counts.steps} steps failed)`,
  );

  if (options.full) {
    for (const result of summary.steps) {
      if (!result.log) continue;
      lines.push("", `===== ${result.label} =====`);
      lines.push(readFileSync(path.join(ROOT, result.log), "utf8").trimEnd());
    }
  }

  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const startedAt = new Date().toISOString();
  const runDirectory = path.join(options.logsDir, timestampForDirectory());
  mkdirSync(runDirectory, { recursive: true });
  if (options.prune) pruneLogs(options.logsDir);

  const steps = makeSteps(options, runDirectory).filter(
    (step) => (!options.only || options.only.includes(step.id)) && !options.skip.includes(step.id),
  );
  if (steps.length === 0) fail("no steps selected");

  const results = [];
  let failed = false;
  for (const step of steps) {
    if (options.failFast && failed) {
      results.push({ ...skippedStep(step), summary: "not run (fail-fast)" });
      continue;
    }
    if (step.id === "build" && failed && !options.all) {
      results.push(skippedStep(step));
      continue;
    }
    const result = runStep(step, options, runDirectory);
    results.push(result);
    if (result.status === "fail") failed = true;
  }

  const summary = buildSummary(options, runDirectory, results, startedAt);
  writeFileSync(path.join(runDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(runDirectory, "summary.txt"), `${renderText(summary, options)}\n`);

  if (options.json) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(renderText(summary, options));
  }

  return summary.ok ? 0 : 1;
}

process.exitCode = main();
