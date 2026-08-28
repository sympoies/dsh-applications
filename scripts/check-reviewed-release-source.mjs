import { readFileSync } from "node:fs";

function fail(message) {
  process.stderr.write(`reviewed release source invalid: ${message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      fail("arguments must be --name value pairs");
    }
    if (values.has(flag)) {
      fail(`duplicate argument ${flag}`);
    }
    values.set(flag, value);
  }
  for (const required of ["--repository", "--commit", "--associations"]) {
    if (!values.has(required)) {
      fail(`${required} is required`);
    }
  }
  for (const flag of values.keys()) {
    if (!["--repository", "--commit", "--associations", "--reviews"].includes(flag)) {
      fail(`unknown argument ${flag}`);
    }
  }
  return values;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

const argumentsByName = parseArguments(process.argv.slice(2));
const repository = argumentsByName.get("--repository");
const commit = argumentsByName.get("--commit");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  fail("repository must be an owner/name identity");
}
if (!/^[0-9a-f]{40}$/.test(commit)) {
  fail("commit must be a full lowercase Git revision");
}

const associations = readJson(argumentsByName.get("--associations"), "associations");
if (!Array.isArray(associations)) {
  fail("associations must be an array");
}

const qualifying = associations.filter(
  (pullRequest) =>
    Number.isInteger(pullRequest?.number) &&
    pullRequest.number > 0 &&
    pullRequest.state === "closed" &&
    typeof pullRequest.merged_at === "string" &&
    pullRequest.merged_at.length > 0 &&
    pullRequest.merge_commit_sha === commit &&
    pullRequest.base?.ref === "main" &&
    pullRequest.base?.repo?.full_name === repository &&
    pullRequest.head?.repo?.full_name === repository &&
    /^[0-9a-f]{40}$/.test(pullRequest.head?.sha ?? "") &&
    typeof pullRequest.user?.login === "string" &&
    pullRequest.user.login.length > 0,
);

if (qualifying.length !== 1) {
  fail(
    `tagged commit must have exactly one merged same-repository pull request into main; found ${qualifying.length}`,
  );
}

const pullRequest = qualifying[0];
const reviewsPath = argumentsByName.get("--reviews");
if (reviewsPath === undefined) {
  process.stdout.write(`${pullRequest.number}\n`);
  process.exit(0);
}

const reviews = readJson(reviewsPath, "reviews");
if (!Array.isArray(reviews)) {
  fail("reviews must be an array");
}

const decisiveStates = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
const latestReviewByIdentity = new Map();
const reviewIds = new Set();
for (const review of reviews) {
  if (!decisiveStates.has(review?.state)) {
    continue;
  }
  if (
    !Number.isInteger(review.id) ||
    review.id <= 0 ||
    reviewIds.has(review.id) ||
    typeof review.user?.login !== "string" ||
    review.user.login.length === 0 ||
    !/^[0-9a-f]{40}$/.test(review.commit_id ?? "") ||
    typeof review.submitted_at !== "string" ||
    !Number.isFinite(Date.parse(review.submitted_at))
  ) {
    fail("decisive review records must have unique ids, identities, revisions, and submission times");
  }
  reviewIds.add(review.id);
  const identity = review.user.login.toLowerCase();
  const previous = latestReviewByIdentity.get(identity);
  const submittedAt = Date.parse(review.submitted_at);
  if (
    previous === undefined ||
    submittedAt > previous.submittedAt ||
    (submittedAt === previous.submittedAt && review.id > previous.review.id)
  ) {
    latestReviewByIdentity.set(identity, { review, submittedAt });
  }
}

const authorIdentity = pullRequest.user.login.toLowerCase();
const approval = [...latestReviewByIdentity.entries()].find(
  ([identity, { review }]) =>
    identity !== authorIdentity &&
    review.state === "APPROVED" &&
    review.commit_id === pullRequest.head.sha,
)?.[1].review;
if (approval === undefined) {
  fail("associated pull request head requires a latest-state APPROVED review from an identity other than its author");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    repository,
    commit,
    pull_request: pullRequest.number,
    pull_author: pullRequest.user.login,
    reviewed_head: pullRequest.head.sha,
    approver: approval.user.login,
  })}\n`,
);
