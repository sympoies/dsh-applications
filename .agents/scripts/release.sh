#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly repo_root

usage() {
  cat <<'USAGE'
Usage:
  .agents/scripts/release.sh --dry-run --version VERSION --expected-head SHA --repository OWNER/REPO
  .agents/scripts/release.sh --execute --version VERSION --expected-head SHA --repository OWNER/REPO
  .agents/scripts/release.sh --verify-only --version VERSION --expected-head SHA --repository OWNER/REPO

Options:
  --remote NAME       Git remote to verify and publish (default: origin).
  --timeout SECONDS   Release-workflow discovery timeout (default: 180).
  --no-wait           Return after publishing and verifying the signed tag.

Dry-run is the default and performs every read-only source and provider gate.
Execute creates one annotated signed v<semver> tag and pushes only that tag.
Verify-only resumes read-back for an already published immutable tag.
USAGE
}

die() {
  printf 'release: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

normalize_version() {
  local value="${1#v}"
  [[ "$value" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] ||
    die "version must be SemVer without build metadata: $1"
  printf '%s\n' "$value"
}

remote_tag_refs() {
  git -C "$repo_root" ls-remote --tags "$remote" \
    "refs/tags/$tag" "refs/tags/$tag^{}"
}

verify_remote_tag() {
  local refs direct peeled verified reason
  refs="$(remote_tag_refs)"
  direct="$(awk -v ref="refs/tags/$tag" '$2 == ref { print $1 }' <<<"$refs")"
  peeled="$(awk -v ref="refs/tags/$tag^{}" '$2 == ref { print $1 }' <<<"$refs")"
  [[ "$direct" =~ ^[0-9a-f]{40}$ ]] || die "remote annotated tag is missing: $tag"
  [[ "$peeled" == "$expected_head" ]] || die "remote tag does not resolve to the expected head: $tag"
  verified="$(gh api "repos/$repository/git/tags/$direct" --jq '.verification.verified')"
  reason="$(gh api "repos/$repository/git/tags/$direct" --jq '.verification.reason')"
  [[ "$verified" == true && "$reason" == valid ]] ||
    die "GitHub does not report a valid tag signature: $tag"
}

find_release_run() {
  gh run list \
    --repo "$repository" \
    --workflow release.yml \
    --event push \
    --branch "$tag" \
    --limit 20 \
    --json databaseId,headSha \
    --jq ".[] | select(.headSha == \"$expected_head\") | .databaseId" |
    sed -n '1p'
}

wait_for_release() {
  local started now run_id release_json
  started="$(date +%s)"
  run_id=''
  while [[ -z "$run_id" ]]; do
    run_id="$(find_release_run)"
    if [[ -n "$run_id" ]]; then
      break
    fi
    now="$(date +%s)"
    (( now - started < timeout )) ||
      die "release workflow did not appear within ${timeout}s for $tag"
    sleep 5
  done
  gh run watch "$run_id" --repo "$repository" --exit-status
  release_json="$(gh release view "$tag" --repo "$repository" --json tagName,url,assets)" ||
    die "release workflow completed without an immutable GitHub Release: $tag"
  jq -e --arg tag "$tag" '
    .tagName == $tag and
    ([.assets[].name | select(endswith(".tgz"))] | length == 1) and
    ([.assets[].name] | index("SHA256SUMS") != null) and
    ([.assets[].name] | index("dsh-applications-lock.json") != null)
  ' <<<"$release_json" >/dev/null || die "release assets are incomplete for $tag"
  printf 'release_url=%s\n' "$(jq -r '.url' <<<"$release_json")"
}

mode='dry-run'
version=''
expected_head=''
repository=''
remote='origin'
timeout=180
wait=1

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dry-run)
      mode='dry-run'
      shift
      ;;
    --execute)
      mode='execute'
      shift
      ;;
    --verify-only)
      mode='verify-only'
      shift
      ;;
    --version)
      [[ "$#" -ge 2 ]] || die '--version requires a value'
      version="$(normalize_version "$2")"
      shift 2
      ;;
    --expected-head)
      [[ "$#" -ge 2 ]] || die '--expected-head requires a value'
      expected_head="$2"
      shift 2
      ;;
    --repository)
      [[ "$#" -ge 2 ]] || die '--repository requires a value'
      repository="$2"
      shift 2
      ;;
    --remote)
      [[ "$#" -ge 2 ]] || die '--remote requires a value'
      remote="$2"
      shift 2
      ;;
    --timeout)
      [[ "$#" -ge 2 ]] || die '--timeout requires a value'
      timeout="$2"
      [[ "$timeout" =~ ^[1-9][0-9]*$ ]] || die '--timeout must be a positive integer'
      shift 2
      ;;
    --no-wait)
      wait=0
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
done

need_command git
need_command gh
need_command jq
need_command node

[[ -n "$version" ]] || die '--version is required'
[[ "$expected_head" =~ ^[0-9a-f]{40}$ ]] || die '--expected-head must be a full lowercase Git revision'
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] ||
  die '--repository must be an owner/name identity'

tag="v$version"
cd "$repo_root"
[[ -z "$(git status --porcelain=v1)" ]] || die 'release requires a clean checkout'
[[ "$(git branch --show-current)" == main ]] || die 'release must run from main'
[[ "$(git rev-parse HEAD)" == "$expected_head" ]] || die 'HEAD is not the expected release head'
[[ "$(node -p "require('./package.json').version")" == "$version" ]] ||
  die 'requested version does not match package.json'
git fetch --quiet --no-tags "$remote" main
[[ "$(git rev-parse "$remote/main")" == "$expected_head" ]] ||
  die "$remote/main is not the expected release head"

temporary_root="$(mktemp -d /tmp/dsh-applications-release.XXXXXX)"
trap '/usr/bin/find "$temporary_root" -depth -delete' EXIT INT TERM
associations="$temporary_root/associations.json"
reviews="$temporary_root/reviews.json"
gh api --paginate --slurp \
  -H 'Accept: application/vnd.github+json' \
  "repos/$repository/commits/$expected_head/pulls" |
  jq 'add' >"$associations"
pull_request="$(node scripts/check-reviewed-release-source.ts \
  --repository "$repository" \
  --commit "$expected_head" \
  --associations "$associations")"
gh api --paginate --slurp \
  -H 'Accept: application/vnd.github+json' \
  "repos/$repository/pulls/$pull_request/reviews" |
  jq 'add' >"$reviews"
review_result="$(node scripts/check-reviewed-release-source.ts \
  --repository "$repository" \
  --commit "$expected_head" \
  --associations "$associations" \
  --reviews "$reviews")"

if [[ "$mode" == verify-only ]]; then
  verify_remote_tag
  printf 'tag=%s\ncommit=%s\nreview=%s\nstatus=published\n' \
    "$tag" "$expected_head" "$review_result"
  if (( wait )); then
    wait_for_release
  fi
  exit 0
fi

[[ -z "$(remote_tag_refs)" ]] || die "immutable remote tag already exists: $tag"
[[ ! -e ".git/refs/tags/$tag" ]] || die "local tag already exists: $tag"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 &&
  die "local tag already exists: $tag"
if gh release view "$tag" --repo "$repository" >/dev/null 2>&1; then
  die "immutable GitHub Release already exists: $tag"
fi

if [[ "$mode" == dry-run ]]; then
  printf 'tag=%s\ncommit=%s\nreview=%s\nstatus=ready\n' \
    "$tag" "$expected_head" "$review_result"
  exit 0
fi

git tag -s "$tag" "$expected_head" -m "dsh-applications $tag"
[[ "$(git cat-file -t "refs/tags/$tag")" == tag ]] || die "signed tag is not annotated: $tag"
git verify-tag "$tag" >/dev/null 2>&1 || die "local tag signature verification failed: $tag"
git push "$remote" "refs/tags/$tag:refs/tags/$tag"
verify_remote_tag
printf 'tag=%s\ncommit=%s\nreview=%s\nstatus=published\n' \
  "$tag" "$expected_head" "$review_result"
if (( wait )); then
  wait_for_release
fi
