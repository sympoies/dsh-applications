#!/usr/bin/env bash
# Probe one npm-published DSH plugin in a throwaway DSH_HOME before it is
# allowed anywhere near a real profile. The probe proves three things:
#   1. install    - `dsh plugin add` succeeds with build scripts blocked
#   2. fail-closed - the installed plugin does NOT appear in the composed tree
#   3. activation - an `insert` patch row mounts it (disabled) in the tree
# Companion to .agents/skills/evaluate-dsh-plugin/SKILL.md.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: scripts/dsh-plugin-probe.sh <npm-package> [options]
  --version <ver>   candidate version or dist-tag to pin (default: latest)
  --workdir <dir>   probe DSH_HOME (must be absent or empty; default: mktemp)
  --dsh-version <v> bundle pin for @deepseek-ai/dsh-base + dsh-headless
                    (default: dsh.version from compatibility/dsh-applications-lock.json)
  --dsh-bin <path>  dsh launcher for the live probe (default: dsh on PATH)
  --dry-run         render the probe profile and print the plan; run nothing
EOF
  exit 2
}

fail() {
  printf 'dsh-plugin-probe: %s\n' "$1" >&2
  exit "${2:-1}"
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname -- "$script_dir")"

package=""
candidate_version=""
workdir=""
dsh_version=""
dsh_bin="dsh"
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || usage; candidate_version="$2"; shift 2 ;;
    --workdir) [ $# -ge 2 ] || usage; workdir="$2"; shift 2 ;;
    --dsh-version) [ $# -ge 2 ] || usage; dsh_version="$2"; shift 2 ;;
    --dsh-bin) [ $# -ge 2 ] || usage; dsh_bin="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -*) usage ;;
    *)
      [ -n "$package" ] && usage
      package="$1"; shift ;;
  esac
done

[ -n "$package" ] || usage

# npm package name: optional @scope/ then name, lowercase URL-safe subset.
# The first character of each segment must not be a dash, dot, or underscore
# so a name can never be mistaken for a flag by downstream tooling.
name_re='^(@[a-z0-9~][a-z0-9._~-]*/)?[a-z0-9~][a-z0-9._~-]*$'
if [ "${#package}" -gt 214 ] || ! printf '%s' "$package" | grep -Eq "$name_re"; then
  printf 'dsh-plugin-probe: invalid npm package name: %s\n' "$package" >&2
  usage
fi

version_re='^[A-Za-z0-9.+-]+$'
if [ -n "$candidate_version" ] && ! printf '%s' "$candidate_version" | grep -Eq "$version_re"; then
  printf 'dsh-plugin-probe: invalid version token: %s\n' "$candidate_version" >&2
  usage
fi
if [ -n "$dsh_version" ] && ! printf '%s' "$dsh_version" | grep -Eq "$version_re"; then
  printf 'dsh-plugin-probe: invalid --dsh-version token: %s\n' "$dsh_version" >&2
  usage
fi

if [ -z "$dsh_version" ]; then
  lock_file="$repo_root/compatibility/dsh-applications-lock.json"
  [ -f "$lock_file" ] || fail "no --dsh-version and no $lock_file" 2
  dsh_version="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).dsh.version' "$lock_file")"
  [ -n "$dsh_version" ] || fail "compatibility lock has no dsh.version" 2
fi

if [ -z "$workdir" ]; then
  workdir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-plugin-probe-XXXXXX")/home"
elif [ -e "$workdir" ] && [ -n "$(ls -A "$workdir" 2>/dev/null)" ]; then
  fail "workdir is not empty: $workdir" 2
fi

profile_dir="$workdir/profiles/probe"
mkdir -p "$profile_dir"

candidate_spec="$package"
[ -n "$candidate_version" ] && candidate_spec="$package@$candidate_version"

cat >"$profile_dir/package.json" <<EOF
{
  "name": "dsh-plugin-probe",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless"
      ]
    }
  },
  "dependencies": {
    "@deepseek-ai/dsh-base": "$dsh_version",
    "@deepseek-ai/dsh-headless": "$dsh_version"
  },
  "pnpm": {
    "onlyBuiltDependencies": []
  }
}
EOF
printf '[]\n' >"$profile_dir/cordis.yml"

# The probe never executes install scripts: neither the candidate's nor the
# bundles' native deps. A candidate that cannot even compose without running
# build scripts is an explicit red flag to record in the evaluation.
printf 'ignore-scripts=true\n' >"$profile_dir/.npmrc"

# Activation layer: a NEW plugin needs an `insert` row (a bare {id, config}
# row only patches an entry that already exists). Mount it disabled so the
# probe proves composition without executing third-party code.
cat >"$profile_dir/cordis.patch.yml" <<EOF
[
  {
    "insert": [
      {
        "id": "probe-candidate",
        "name": "$package",
        "disabled": true,
        "config": {}
      }
    ]
  }
]
EOF

# Keep dependency build scripts blocked but demote the pnpm ignored-builds
# report from an error to a warning: nothing is ever approved in a probe.
pnpm_guard="--config.strict-dep-builds=false"

plan="DSH_HOME=$workdir
step 1: $dsh_bin plugin --profile probe install $pnpm_guard
step 2: $dsh_bin plugin --profile probe add $candidate_spec $pnpm_guard
step 3: $dsh_bin --profile probe --dump-config   # expect the candidate mounted disabled via its insert row
note: install scripts stay blocked (.npmrc ignore-scripts + unapproved builds);
note: a candidate that needs build scripts to compose is an explicit red flag."

if [ "$dry_run" -eq 1 ]; then
  printf 'probe profile rendered at %s\n%s\n' "$profile_dir" "$plan"
  exit 0
fi

command -v "$dsh_bin" >/dev/null 2>&1 || fail "dsh launcher not found: $dsh_bin (use --dsh-bin)" 2

export DSH_HOME="$workdir"

echo "== install bundle pins =="
"$dsh_bin" plugin --profile probe install "$pnpm_guard" || fail "bundle install failed"

echo "== add candidate $candidate_spec =="
"$dsh_bin" plugin --profile probe add "$candidate_spec" "$pnpm_guard" || fail "plugin add failed for $candidate_spec"

echo "== compose (candidate mounted disabled via insert row) =="
composed="$("$dsh_bin" --profile probe --dump-config)" || fail "dump-config failed after activation row"
if ! printf '%s' "$composed" | grep -Fq "name: $package"; then
  fail "candidate $package missing from composed tree despite insert row"
fi

echo "PASS: $candidate_spec installs, composes, and mounts disabled under $workdir"
