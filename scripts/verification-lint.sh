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
# The Creator Portal always reviews with the LATEST scanner, so this mirrors the
# latest too: the version is resolved from npm on every run, never pinned by
# hand. Offline, a local run falls back to the last installed version (with a
# warning); `--latest` (used by verify.sh --full) refuses to run without it.
#
#   ./scripts/verification-lint.sh            # lint the working tree
#   ./scripts/verification-lint.sh --latest   # same, but the latest scanner is mandatory
#   ./scripts/verification-lint.sh --refresh  # re-download the toolchain
set -euo pipefail
cd "$(dirname "$0")/.."

TOOLROOT="node_modules/.verification-lint"   # one subdirectory per scanner version
REQUIRE_LATEST=0
for arg in "$@"; do
  case "$arg" in
    --latest)  REQUIRE_LATEST=1 ;;
    --refresh) rm -rf "$TOOLROOT" ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Pre-versioned layout (toolchain directly in TOOLROOT) — drop it.
[[ -f "$TOOLROOT/package.json" ]] && rm -rf "$TOOLROOT"

latest=$(npm view @n8n/scan-community-package@latest version 2>/dev/null | tr -d '[:space:]' || true)
installed=$(ls -1 "$TOOLROOT" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)

if [[ -n "$latest" ]]; then
  SCANNER_VERSION="$latest"
  echo "Scanner ruleset: @n8n/scan-community-package@$SCANNER_VERSION (latest on npm — what the Creator Portal uses)"
elif [[ $REQUIRE_LATEST -eq 1 ]]; then
  echo "Could not read the latest scanner version from npm (offline?). A release gate needs the latest ruleset." >&2
  exit 2
elif [[ -n "$installed" ]]; then
  SCANNER_VERSION="$installed"
  printf '\033[33mOffline: using the last installed scanner %s — the Portal may already run a newer one.\033[0m\n' "$SCANNER_VERSION"
else
  echo "Offline and no scanner installed yet — network required on first run." >&2
  exit 2
fi

TOOLDIR="$TOOLROOT/$SCANNER_VERSION"
if [[ ! -d "$TOOLDIR/node_modules/@n8n/scan-community-package" ]]; then
  echo "Installing the verification scanner $SCANNER_VERSION into $TOOLDIR…"
  rm -rf "$TOOLDIR"
  mkdir -p "$TOOLDIR"
  cat > "$TOOLDIR/package.json" <<EOF
{ "name": "fiwano-verification-lint", "private": true, "version": "1.0.0" }
EOF
  # Installing the scanner pulls its exact eslint + both plugins + ts parser, so
  # buildScanConfig resolves them from here — no version guessing on our side.
  (cd "$TOOLDIR" && npm install --silent --no-audit --no-fund \
      "@n8n/scan-community-package@$SCANNER_VERSION") \
    || { rm -rf "$TOOLDIR"; echo "Install failed."; exit 2; }
  # Keep only the version just installed.
  find "$TOOLROOT" -mindepth 1 -maxdepth 1 ! -name "$SCANNER_VERSION" -exec rm -rf {} +
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
