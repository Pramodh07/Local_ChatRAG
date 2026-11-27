# Agent verification runner

`check.mjs` runs the repository check workflow and prints a short summary instead
of the full tool output. It is designed for AI agents and CI logs where reading a
large transcript wastes tokens.

## Commands

```bash
pnpm verify:agent       # full workflow, compact summary
pnpm verify:fast        # typecheck + lint + db:types:check
pnpm verify:json        # compact JSON for machine consumption
```

Direct invocation:

```powershell
.\scripts\agent\check.ps1
```

```sh
sh scripts/agent/check.sh
```

## What runs

| Step | Command | Notes |
| --- | --- | --- |
| `typecheck` | `pnpm run typecheck` | Parses `file(line,col): error TSxxxx` |
| `lint` | `pnpm run lint -- --format json` | Parses ESLint's JSON formatter |
| `db:types` | `pnpm run db:types:check` | Reports stale generated types |
| `test` | `pnpm run test -- --reporter=json --outputFile=…` | Parses Vitest's JSON report |
| `build` | `pnpm run build` | Skipped when an earlier step fails unless `--all` |

The step order matches `pnpm check`. `build` is skipped after a failure because it
would fail for the same reason and is the slowest step.

## Options

```text
--only <steps>      Comma-separated subset: typecheck, lint, db:types, test, build
--skip <steps>      Comma-separated steps to skip
--test <pattern>    Run only matching Vitest files in the test step
--json              Print one compact JSON object instead of text
--quiet             Omit the header and log paths
--full              Print the full captured output for each step
--fail-fast         Stop after the first failing step
--all               Run build even when earlier steps fail
--max-lines <n>     Max failure lines printed per step (default 12)
--timeout <s>       Per-step timeout in seconds (default 900)
--logs-dir <path>   Log directory (default .agent-logs)
--no-prune          Keep more than the last 10 log runs
```

## Examples

```bash
# Quick signal while editing
pnpm verify:fast

# One test file only
pnpm verify:agent --only test --test tests/conversation-diff.test.ts

# Everything, including build, even if earlier steps fail
pnpm verify:agent --all

# Machine-readable result
pnpm verify:json
```

## Output and logs

Default text output is limited to:

- one line per step (status, duration, failure count)
- up to `--max-lines` failure lines per step
- hints for the failing steps
- the log directory and `summary.json` path

Every run writes to `.agent-logs/<timestamp>/`:

| File | Contents |
| --- | --- |
| `<step>.log` | Full stdout and stderr for that step |
| `vitest.json` | Raw Vitest JSON report |
| `summary.json` | Structured result: statuses, durations, failures, counts |
| `summary.txt` | The compact text report |

`.agent-logs/` is ignored by Git and pruned to the last 10 runs.

### `summary.json` shape

```json
{
  "ok": false,
  "startedAt": "2026-11-25T09:41:02.000Z",
  "finishedAt": "2026-11-25T09:41:42.000Z",
  "durationMs": 40000,
  "platform": "win32",
  "node": "v24.18.0",
  "steps": [
    {
      "id": "typecheck",
      "label": "typecheck",
      "status": "fail",
      "exitCode": 2,
      "durationMs": 4200,
      "summary": "4 errors",
      "failures": ["src/file.ts:10:5 TS2345 ..."],
      "log": ".agent-logs/2026-11-25T09-41-02-000Z/typecheck.log"
    }
  ],
  "counts": { "steps": 5, "failedSteps": 1, "failures": 4 },
  "logsDir": ".agent-logs/2026-11-25T09-41-02-000Z",
  "summaryPath": ".agent-logs/2026-11-25T09-41-02-000Z/summary.json"
}
```

An agent should read `summary.json` (or the default text output) first, then open a
specific `<step>.log` only when the summary is insufficient.
