#!/usr/bin/env bash
#
# Pre-release gate for n8n-nodes-fiwano.
#
# Run this before every release, and ideally before every commit that touches
# nodes/ or credentials/. It is ordered cheapest-first so you fail fast.
#
#   ./scripts/verify.sh          # local gates only (fast, offline)
#   ./scripts/verify.sh --full   # + official n8n scanner (network, ~1 min)
#
# Exit code 0 means every gate passed. Any non-zero means DO NOT publish.
set -uo pipefail
cd "$(dirname "$0")/.."

FULL=0
[[ "${1:-}" == "--full" ]] && FULL=1

PASS=0; FAIL=0; SKIP=0
declare -a FAILED_GATES=()

gate() {
  local name="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$name"
  if "$@"; then
    printf '\033[32m   PASS\033[0m — %s\n' "$name"; PASS=$((PASS+1))
  else
    printf '\033[31m   FAIL\033[0m — %s\n' "$name"; FAIL=$((FAIL+1)); FAILED_GATES+=("$name")
  fi
}

# 1. Compiles. Everything downstream reads dist/, so this must run first.
gate "TypeScript build" npm run build

# 2. Repo lint (the project's own eslint config).
gate "Repo lint" npm run lint

# 3. Backward compatibility. THE gate that protects existing users: it compares
#    the compiled node's stored contract (operation values, parameter names,
#    option values, credential fields) against the committed baseline.
gate "Backward-compatibility contract" node scripts/contract.mjs check

# 4. The error mapper runs inside a catch block; a throw there hides the real
#    API failure. 22 hostile shapes, including n8n-wrapped errors and buffers.
gate "Error-mapper regression" node scripts/error-mapper.test.mjs

# 5. Headless load: n8n shows a "yellow node" when a description is malformed.
#    Requiring the compiled classes and reading their properties catches that
#    without a browser.
gate "Headless node load" node -e '
const assert = require("assert");
for (const f of ["Fiwano.node.js", "FiwanoTrigger.node.js"]) {
  const mod = require("./dist/nodes/Fiwano/" + f);
  const Cls = Object.values(mod).find((v) => typeof v === "function");
  const d = new Cls().description;
  assert(d.name && d.displayName, f + ": missing name/displayName");
  assert(Array.isArray(d.properties) && d.properties.length, f + ": no properties");
  for (const p of d.properties) {
    assert(p.name, f + ": property without name");
    assert(p.type, f + ": property " + p.name + " without type");
    if (p.type === "options" || p.type === "multiOptions") {
      assert(Array.isArray(p.options) && p.options.length, f + ": " + p.name + " has no options");
    }
    if (p.name === "resource" || p.name === "operation") {
      assert(p.noDataExpression === true, f + ": " + p.name + " must set noDataExpression");
    }
  }
}
const mod = require("./dist/credentials/FiwanoApi.credentials.js");
const Cred = Object.values(mod).find((v) => typeof v === "function");
const c = new Cred();
assert(c.name && c.displayName && Array.isArray(c.properties), "credential malformed");
console.log("   both nodes + credential load with valid descriptions");
'

# 6. Every operation the UI offers must be reachable in execute(). A dropdown
#    entry with no branch behind it throws "Unknown … operation" at runtime.
gate "Operations are implemented" node -e '
const assert = require("assert");
const src = require("fs").readFileSync("./dist/nodes/Fiwano/Fiwano.node.js", "utf8");
const { Fiwano } = require("./dist/nodes/Fiwano/Fiwano.node.js");
let checked = 0;
for (const p of new Fiwano().description.properties) {
  if (p.name !== "operation") continue;
  for (const o of p.options) {
    assert(
      src.includes("\x27" + o.value + "\x27") || src.includes("\x22" + o.value + "\x22"),
      "operation \x27" + o.value + "\x27 is offered in the UI but never handled in execute()",
    );
    checked++;
  }
}
console.log("   " + checked + " operations all reachable in execute()");
'

# 7. Verified community nodes may not ship runtime dependencies.
gate "No runtime dependencies" node -e '
const p = require("./package.json");
const deps = Object.keys(p.dependencies || {});
if (deps.length) { console.error("   runtime deps present: " + deps.join(", ")); process.exit(1); }
if (!(p.peerDependencies || {})["n8n-workflow"]) { console.error("   n8n-workflow must be a peerDependency"); process.exit(1); }
if (!(p.keywords || []).includes("n8n-community-node-package")) { console.error("   missing n8n-community-node-package keyword"); process.exit(1); }
console.log("   no runtime deps; n8n-workflow is a peer dep; keyword present");
'

# 8. The icon is copied by the build, not by npm — a missing file means every
#    node renders blank in the panel.
gate "Packaged assets" bash -c '
test -f dist/nodes/Fiwano/fiwano.svg || { echo "   dist/nodes/Fiwano/fiwano.svg missing"; exit 1; }
node -e "
const p=require(\"./package.json\");
for (const f of [...p.n8n.nodes, ...p.n8n.credentials]) {
  require(\"fs\").accessSync(f);
}
console.log(\"   icon present; every path in package.json n8n.{nodes,credentials} exists\");
"'

# 9. n8n's VERIFICATION ruleset against the working tree. This is the gate the
#    Creator Portal applies; running it locally is the only way to see it before
#    publishing, because the official scanner can only fetch from npm.
gate "n8n verification ruleset (working tree)" ./scripts/verification-lint.sh

# 10. The official scanner itself. Network + slow, and it reads the PUBLISHED
#     package, so it validates the last release rather than your working tree —
#     keep it as a final confirmation, not as your feedback loop.
if [[ $FULL -eq 1 ]]; then
  # The scanner exits 0 even when it reports errors, so its exit code is not a
  # gate. Parse the summary line instead.
  gate "Official n8n scanner (published package)" bash -c '
    out=$(npx --yes @n8n/scan-community-package n8n-nodes-fiwano 2>&1)
    printf "%s\n" "$out" | tail -25
    errs=$(printf "%s" "$out" | grep -oE "[0-9]+ error" | head -1 | grep -oE "[0-9]+")
    if [[ -n "$errs" && "$errs" -gt 0 ]]; then
      printf "   %s error(s) in the PUBLISHED package. If this release fixes them, they clear once it is on npm.\n" "$errs"
      exit 1
    fi
    exit 0
  ' 
else
  printf '\n\033[1m── Official n8n scanner (published package)\033[0m\n\033[33m   SKIP\033[0m — re-run with --full before releasing\n'
  SKIP=$((SKIP+1))
fi

printf '\n\033[1m════ %d passed, %d failed, %d skipped ════\033[0m\n' "$PASS" "$FAIL" "$SKIP"
if [[ $FAIL -gt 0 ]]; then
  printf '\033[31mDO NOT PUBLISH.\033[0m Failed gates:\n'
  for g in "${FAILED_GATES[@]}"; do printf '  - %s\n' "$g"; done
  exit 1
fi
printf '\033[32mAll local gates passed.\033[0m\n'
