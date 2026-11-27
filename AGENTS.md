<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent verification workflow

Use the bundled runner instead of re-running checks by hand:

- `pnpm verify:agent` — full workflow with a compact summary.
- `pnpm verify:fast` — typecheck, lint, and generated-type check only.
- `pnpm verify:json` — compact JSON for machine parsing.
- Targeted tests: `pnpm verify:agent --only test --test <file>`.

Full logs go to `.agent-logs/<timestamp>/`. Read `summary.json` or one
`<step>.log` only when the summary is insufficient; do not paste entire logs.
See `scripts/agent/README.md` for options.
