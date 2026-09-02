#!/usr/bin/env bash
#
# Run n8n's VERIFICATION ruleset (@n8n/eslint-plugin-community-nodes) against the
# WORKING TREE.
#
# Why this exists: `npx @n8n/scan-community-package n8n-nodes-fiwano` only ever
# fetches the package from the npm registry, so it can tell you nothing about
# code you have not published yet. That is backwards for a pre-release gate —
# by the time it can see your change, the change is already public.
#
# The plugin needs eslint 9 while the repo is pinned to eslint 8 (required by
# eslint-plugin-n8n-nodes-base), so it is installed into an isolated directory
# instead of the project's dependency tree. First run downloads; later runs are
# offline and instant.
#
#   ./scripts/verification-lint.sh            # lint the working tree
#   ./scripts/verification-lint.sh --refresh  # re-download the toolchain
set -euo pipefail
cd "$(dirname "$0")/.."

TOOLDIR="node_modules/.verification-lint"
PLUGIN_VERSION="0.31.0"
ESLINT_VERSION="9"

if [[ "${1:-}" == "--refresh" ]]; then rm -rf "$TOOLDIR"; fi

if [[ ! -d "$TOOLDIR/node_modules/@n8n/eslint-plugin-community-nodes" ]]; then
  echo "Installing the verification toolchain into $TOOLDIR (first run only)…"
  mkdir -p "$TOOLDIR"
  cat > "$TOOLDIR/package.json" <<EOF
{ "name": "fiwano-verification-lint", "private": true, "version": "1.0.0" }
EOF
  (cd "$TOOLDIR" && npm install --silent --no-audit --no-fund \
      "eslint@$ESLINT_VERSION" \
      "@n8n/eslint-plugin-community-nodes@$PLUGIN_VERSION" \
      "@typescript-eslint/parser") \
    || { echo "Install failed — network required on first run."; exit 2; }
fi

ROOT="$(pwd)"
cat > "$TOOLDIR/eslint.config.mjs" <<EOF
import cn from '$ROOT/$TOOLDIR/node_modules/@n8n/eslint-plugin-community-nodes/dist/plugin.js';
import tsparser from '$ROOT/$TOOLDIR/node_modules/@typescript-eslint/parser/dist/index.js';

const recommended = cn.configs.recommended;

export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  {
    files: ['**/nodes/**/*.ts', '**/credentials/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: recommended.plugins,
    rules: recommended.rules,
  },
];
EOF

# The source carries eslint-disable comments for rules from the OTHER plugin
# (eslint-plugin-n8n-nodes-base), which is not loaded here. eslint would report
# each as "Definition for rule ... was not found", so those lines are filtered
# out — they are an artefact of running one ruleset in isolation, not findings.
set +e
OUT=$("$TOOLDIR/node_modules/.bin/eslint" \
        --config "$TOOLDIR/eslint.config.mjs" \
        nodes credentials 2>&1)
set -e

FILTERED=$(printf '%s\n' "$OUT" | grep -v "was not found" || true)
ERRORS=$(printf '%s\n' "$FILTERED" | grep -cE '^\s+[0-9]+:[0-9]+\s+error' || true)
WARNINGS=$(printf '%s\n' "$FILTERED" | grep -cE '^\s+[0-9]+:[0-9]+\s+warning' || true)

printf '%s\n' "$FILTERED" | grep -E '^/|^\s+[0-9]+:[0-9]+' || true

if [[ "$ERRORS" -gt 0 ]]; then
  printf '\n\033[31m%s verification error(s)\033[0m — the Creator Portal gate would reject this.\n' "$ERRORS"
  exit 1
fi
printf '\nVerification ruleset: 0 errors, %s warning(s).\n' "$WARNINGS"
