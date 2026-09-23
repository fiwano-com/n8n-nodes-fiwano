#!/usr/bin/env bash
#
# Run n8n's VERIFICATION scanner ruleset against the WORKING TREE — a faithful
# mirror of what the Creator Portal applies.
#
# Why this exists: `npx @n8n/scan-community-package n8n-nodes-fiwano` only ever
# fetches the package (source from GitHub, tarball from npm) — it can tell you
# nothing about code you have not published yet. That is backwards for a
# pre-release gate: by the time it can see your change, the change is public.
# (v1.3.0 was rejected exactly this way — a lint rule the pre-publish gate missed.)
#
# Faithfulness is the whole point, so this does NOT hand-roll a config. It imports
# the scanner's OWN `buildScanConfig` from `@n8n/scan-community-package` and runs
# ESLint with the scanner's exact settings:
#   * BOTH plugins: `@n8n/eslint-plugin-community-nodes` (recommended) AND the full
#     `eslint-plugin-n8n-nodes-base` rulesets (nodes/credentials/community) with the
#     scanner's off-overrides — the sort rule that rejected v1.3.0 lives here.
#   * `allowInlineConfig: false` — the scanner IGNORES `// eslint-disable` comments,
#     so we must too. An inline disable can never hide a scanner finding again.
# Pinned to the scanner version so results are deterministic; the `--full` currency
# gate in verify.sh fails the release if the pin drifts behind npm.
#
#   ./scripts/verification-lint.sh            # lint the working tree
#   ./scripts/verification-lint.sh --refresh  # re-download the toolchain
set -euo pipefail
cd "$(dirname "$0")/.."

TOOLDIR="node_modules/.verification-lint"
# The scanner version whose ruleset we mirror. Keep in sync with npm (verify.sh
# --full checks this) and bump deliberately, re-running to catch new rules.
SCANNER_VERSION="0.37.0"

if [[ "${1:-}" == "--refresh" ]]; then rm -rf "$TOOLDIR"; fi

if [[ ! -d "$TOOLDIR/node_modules/@n8n/scan-community-package" ]]; then
  echo "Installing the verification scanner into $TOOLDIR (first run only)…"
  mkdir -p "$TOOLDIR"
  cat > "$TOOLDIR/package.json" <<EOF
{ "name": "fiwano-verification-lint", "private": true, "version": "1.0.0" }
EOF
  # Installing the scanner pulls its exact eslint + both plugins + ts parser, so
  # buildScanConfig resolves them from here — no version guessing on our side.
  (cd "$TOOLDIR" && npm install --silent --no-audit --no-fund \
      "@n8n/scan-community-package@$SCANNER_VERSION") \
    || { echo "Install failed — network required on first run."; exit 2; }
fi

# Runner: import the scanner's own config and lint OUR working tree with it.
cat > "$TOOLDIR/scan-lint.mjs" <<'EOF'
import { ESLint } from 'eslint';
import { buildScanConfig } from '@n8n/scan-community-package/scanner/scanner.mjs';

// Same knobs the scanner uses (scanner.mjs): its exact merged config, and inline
// eslint-disable directives ignored. cwd is the project root so the config's
// `**/nodes/**` / `**/credentials/**` / `package.json` globs match our files.
const eslint = new ESLint({
  cwd: process.cwd(),
  allowInlineConfig: false,
  overrideConfigFile: true,
  overrideConfig: await buildScanConfig(),
});

const results = await eslint.lintFiles(['nodes/**/*.ts', 'credentials/**/*.ts', 'package.json']);
const output = await (await eslint.loadFormatter('stylish')).format(results);
if (output.trim()) console.log(output);

const errors = results.reduce((n, r) => n + r.errorCount, 0);
const warnings = results.reduce((n, r) => n + r.warningCount, 0);
console.log(`\nScanner-mirror lint: ${errors} error(s), ${warnings} warning(s).`);
// Fail on warnings too: the Portal review has rejected on warnings before
// (v1.2.0 icon warnings), and the repo's standard is a clean 0/0.
process.exit(errors > 0 || warnings > 0 ? 1 : 0);
EOF

if node "$TOOLDIR/scan-lint.mjs"; then
  exit 0
else
  printf '\n\033[31mVerification scanner findings\033[0m — the Creator Portal gate would reject this. Fix the source (inline eslint-disable does NOT work — the scanner ignores it).\n'
  exit 1
fi
