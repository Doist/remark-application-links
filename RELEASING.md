# Releasing remark-application-links

## Current migration gate

The intended first release is **@todoist/remark-application-links@1.0.5**. The
current explicit-version policy continues: review a manifest/lock version bump,
merge it, pack that main commit, publish its retained bytes to both registries,
then record `vVERSION` in GitHub. There is no semantic-release version calculation
or new-scope reset. Old `@doist` releases, tags, and changelog entries stay intact.

**Do not merge this migration until @todoist/prettier-config@4.0.2 exists on npm
and the real lock/install checks pass.** The checked-in old lock dependency graph
is deliberately retained until then; only root identity/version metadata changed.
The new config requires Prettier 3. TSDX still checks ESLint rules; its incompatible
Prettier 2 rule is disabled and the Prettier 3 CLI checks formatting separately.
The package's Node >=12 runtime requirement and distribution entrypoints are unchanged.
Build/release tooling uses Node 24.20.0 and npm 11.19.0 (bundled with that Node).
Installs explicitly retain npm 6's legacy peer-resolution behavior: the existing
TSDX 0.14 / ts-jest 25 lock has a TypeScript <4 peer despite this package's existing
TypeScript 4.0.3. Strict-peer install fails on that pre-existing constraint; the
11 behavior tests and build pass. No unrelated compiler/test-tool upgrade is made.

After the upstream publication, in this same branch/worktree:

```sh
npm view @todoist/prettier-config@4.0.2 version --registry=https://registry.npmjs.org/
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps
npm ci --ignore-scripts --no-audit --no-fund --legacy-peer-deps
npm run lint
npm run test:ci
npm run build
npm run test:release
npm pack --ignore-scripts --dry-run
```

Review the real lock diff and commit it before merge. Never commit local paths,
package aliases, invented tarball URLs or integrity hashes. Disposable source
checks do not prove new-scope registry resolution.

## Setup before the real release

An authorized maintainer performs these operations after migration approval; none
are executed by PR preparation.

- GitHub owner/repository: `todoist/remark-application-links` (repository ID
  `300606066`). Rename/transfer must be complete before dispatching this workflow.
- Workflow and npm trusted-publisher caller: **publish.yml**, path
  `.github/workflows/publish.yml`; no reusable caller.
- Runner: GitHub-hosted `ubuntu-latest`; Node `24.20.0` / npm `11.19.0`.
- Create/review the **npm-release** environment, restrict it to `main`, and require
  the existing authorized release maintainer's approval. The pack-only job has no
  environment or registry write permissions. Environment settings:
  <https://github.com/todoist/remark-application-links/settings/environments>.
- Publication needs `contents: read`, `actions: read`, `packages: write` and
  `id-token: write`. GitHub reads use `GH_TOKEN`; registry reads/writes use
  `GH_PACKAGES_TOKEN`. In Actions both are supplied from the job's `github.token`.
  They are removed from every npmjs subprocess. No npm publication token is stored.
- Independently inspect the transferred **public** GitHub mirror, its linked
  repository, publisher rights, inheritance and required consumer **Manage Actions
  access** grants. Existing mirror ID `1570882` was public; npm visibility does not
  establish GitHub visibility. The tool requires readable package metadata,
  `visibility=public` and the correct repository ID before **any** registry write.
  A missing/hidden mirror, denied access, or changed visibility blocks publication,
  including npm bootstrap; an administrator must resolve it first.
  <https://github.com/orgs/todoist/packages/npm/package/remark-application-links/settings>
- Confirm the transferred package state using:
  `gh api orgs/todoist/packages/npm/remark-application-links`.
  Review the current `latest` and exact target versions in both registries. The
  publisher checks both existing exact-version integrities before even a single
  destination write. It fails closed on auth/network ambiguity or different bytes.
- npm's new package must exist before configuring its trusted publisher. First
  publish the actual artifact interactively, using the already-owned `todoist`
  scope and account 2FA. Near the next real automated release, configure owner
  `todoist`, repository `remark-application-links`, workflow `publish.yml`,
  environment `npm-release`, with **direct npm publish** enabled at:
  <https://www.npmjs.com/package/@todoist/remark-application-links/access>.
  A new connection expires after two days without a successful publish. Manual
  bootstrap does not validate OIDC. This workflow does not need dist-tag API
  permission: it selects a tag on publish and never silently promotes a retry.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[GitHub npm authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Produce the first real artifact, without publication

After the reviewed lockfile and migration changes have merged, the operator
checks main's version is still the selected release and dispatches **pack**:

```sh
gh api "repos/todoist/remark-application-links/contents/package.json?ref=main" --jq .content | base64 --decode
gh workflow run publish.yml --repo todoist/remark-application-links --ref main -f operation=pack
gh run list --repo todoist/remark-application-links --workflow publish.yml --event workflow_dispatch --limit 10 --json databaseId,headSha,displayTitle,status,conclusion
```

Select the original successful attempt of the `remark-application-links pack FULL_SHA` run. A later failed rerun does not invalidate its original artifact. Packing always
checks out that run's exact main commit; there is no arbitrary checkout input.
It installs without lifecycle scripts, lints, tests, builds, and packs once with
`--ignore-scripts`. It uploads **remark-application-links-release-RUN_ID-ATTEMPT**, containing
`todoist-remark-application-links-1.0.5.tgz` and `release.json` (schema 2, SHA-256,
SHA-512 integrity, source SHA, run ID, original attempt, filename, name and version).
The pack summary records the immutable artifact ID and archive SHA-256; retain
these with the original run/attempt evidence. Upload names include the attempt,
so reruns cannot replace the original artifact.
No tag, release, registry write or team message occurs during pack.

Set the run/attempt, artifact ID/digest and source SHA below from that actual
successful attempt and its pack summary, never a PR run or a
self-declared metadata file. They are unknown until the future authorized run:

```sh
export ARTIFACT_RUN_ID=ACTUAL_SUCCESSFUL_PACK_RUN_ID
export ARTIFACT_RUN_ATTEMPT=ACTUAL_SUCCESSFUL_PACK_ATTEMPT
export ARTIFACT_ID=ACTUAL_IMMUTABLE_ARCHIVE_ID
export ARTIFACT_DIGEST=sha256:ACTUAL_64_HEX_ARCHIVE_DIGEST
export RELEASE_SHA=ACTUAL_40_CHARACTER_PACK_HEAD_SHA
export RELEASE_VERSION=1.0.5
export RELEASE_TAG=latest
mkdir -p release-artifact
node scripts/release.mjs download release-artifact
node scripts/release.mjs verify release-artifact
```

Use these commands from the reviewed repository checkout with current compatible
release scripts, Node 24.20.0, npm 11.19.0 and `gh` authenticated for repository
Actions reads and `unzip` available. The downloader validates
`actions/runs/RUN_ID/attempts/N`, the artifact ID/name/source/digest API record,
and the downloaded ZIP checksum before extracting its two expected files.
It also retains **artifact.zip** (unchanged archive bytes) and **artifact.json**
(the run/attempt/source/immutable artifact ID/name/archive digest receipt).
Retain all four files, checksum, source/run/attempt URL and workflow evidence
in approved durable release storage; the Actions copy expires after **90 days**.
Keep the original artifact even if only one registry accepts it.

## First interactive npm publication

First confirm `GH_PACKAGES_TOKEN` is a **classic PAT with read:packages** and the
required organization SSO authorization, obtained through the approved credential
flow. Do not print it or paste it into shell history. Existing `gh` authentication
must independently be able to read the source run and artifact; `gh auth token`
is not a guarantee of package read rights.

With the verified artifact and variables above, run in a real terminal:

```sh
node scripts/release.mjs bootstrap-npm release-artifact
```

The script validates the historical successful attempt, exact workflow ID/path,
repository, event, source/main ancestry and source manifest. It independently
checks the immutable artifact API identity/digest and the retained ZIP against
the explicit original digest, then compares its metadata and tarball with the
local files. It never relies on the mutable latest-attempt status or a static
artifact name.
Both npm and GitHub existing same-version copies must match the retained digest;
GitHub visibility/read access must be established. Only then does it invoke npm
login, repeat both-registry preflight, guard `latest`, and publish to npmjs with
`--access=public --ignore-scripts --provenance=false`. **Both login and publish
inherit terminal I/O**, including a fresh publish-time 2FA challenge.

Every operation has temporary, separate registry directories and npm configs.
The GitHub read token never enters npmjs login/publish environments or configs.
No global npm config is changed. A matching existing copy is a no-op; no version
bump or automatic tag promotion occurs.

## Publish the GitHub mirror or a later npm release

Use the same run ID, source SHA and exact version for each destination:

```sh
gh workflow run publish.yml --repo todoist/remark-application-links --ref main \
  -f operation=publish -f artifact_run_id="$ARTIFACT_RUN_ID" \
  -f artifact_run_attempt="$ARTIFACT_RUN_ATTEMPT" -f artifact_id="$ARTIFACT_ID" \
  -f artifact_digest="$ARTIFACT_DIGEST" \
  -f release_sha="$RELEASE_SHA" -f version="$RELEASE_VERSION" \
  -f destination=github -f release_tag=latest
```

For a subsequent real release after npm trust is configured, use the same command
with `-f destination=npmjs`. The environment approval and both-registry preflight
apply to each dispatch. There is **no build, install, pack, version bump or release
creation in the publish job**. Cross-run npm provenance is disabled because the
publishing workflow may run from a newer commit than the artifact's build source.

After both registries report matching integrity and their intended dist-tags,
verify consumer installs through actual npm and GitHub credentials/routing. The
maintainer then completes the normal `v1.0.5` GitHub release record against the
**original source SHA**, with an attributed description if agent-authored. Creating
that record no longer triggers publication. Future versions use an explicit
reviewed semver manifest/lock bump; do not rebuild old release lines.

### Confirm the release record, including interrupted drafts

The release record must retain the **original tarball, release.json, artifact.zip
and artifact.json receipt** for schema2 artifacts. A tag
name in `gh release list` is not completion: the command includes drafts. Before
calling the release complete, fetch the existing tag without force, peel it to a
commit and compare it with `RELEASE_SHA`; inspect the release state and assets:

```sh
git fetch origin "refs/tags/v${RELEASE_VERSION}:refs/tags/v${RELEASE_VERSION}"
test "$(git rev-parse "v${RELEASE_VERSION}^{commit}")" = "$RELEASE_SHA"
gh release view "v${RELEASE_VERSION}" --repo todoist/remark-application-links \
  --json tagName,isDraft,isPrerelease,publishedAt,assets,url
record_dir="$(mktemp -d)"
gh release download "v${RELEASE_VERSION}" --repo todoist/remark-application-links \
  --dir "$record_dir" --pattern "todoist-remark-application-links-${RELEASE_VERSION}.tgz" --pattern release.json --pattern artifact.zip --pattern artifact.json
cmp "release-artifact/todoist-remark-application-links-${RELEASE_VERSION}.tgz" "$record_dir/todoist-remark-application-links-${RELEASE_VERSION}.tgz"
cmp release-artifact/release.json "$record_dir/release.json"
cmp release-artifact/artifact.zip "$record_dir/artifact.zip"
cmp release-artifact/artifact.json "$record_dir/artifact.json"
```

Completion requires the exact source tag commit, `isDraft=false`,
`isPrerelease=false`, a non-null `publishedAt`, matching retained assets, and both
registry copies. If an interrupted operation left a matching draft, the maintainer
resumes that existing draft: upload only missing original assets, verify them,
then explicitly publish it. Stop on a wrong tag commit, conflicting assets, or
unexpected prerelease state for owner review. Do not force-move, delete, or recreate
a tag/release, and do not repack the immutable version. Any agent-authored release
notes must start with `[Posted by Jarvis]`, a blank line, then the body.

## Partial publication and durable recovery

Rerun only the missing destination with the **original run, successful attempt,
artifact ID, archive digest, SHA and version**. Do not bump or repack an immutable version. Successful equal copies are
skipped. Any byte mismatch stops the whole operation before writing anywhere;
resolve it by recovering the original published bytes, never overwriting them.
Concurrent manual publications must be serialized with workflow releases by the
maintainer; workflow concurrency serializes dispatches within this repository.

If the missing destination's `latest` is already newer, the default path stops.
Use the same command with `-f release_tag=migration-recovery` (or locally set
`RELEASE_TAG=migration-recovery` for interactive npm recovery). This publishes only
the absent version under the explicit temporary tag and verifies that `latest`
remains unchanged. The maintainer owns later removal of `migration-recovery` after
both registries and consumer installs are verified; there is no automatic cleanup
or promotion. Do not promote this older version to `latest`.

Later reviewed changes to the workflow or release scripts do not invalidate an
artifact: validation uses the **historical** successful run's workflow identity,
path, event, exact checkout SHA, source manifest and main ancestry, plus schema and
original retained bytes. It never compares the old workflow contents to today's
workflow. Schema 2 binds the original attempt; later failed attempts are irrelevant.
If its schema becomes unsupported, its
artifact expires, the original run is deleted, or main history no longer includes
it, stop for reviewed manual recovery using archived original bytes/checksums and
run evidence. Never solve that situation by rebuilding an already-published version.

### Legacy unversioned records: original-byte recovery

Schema1 `release.json` and the old static `remark-application-links-release` name
lack an original-attempt binding. The automated path rejects them; do not guess
attempt1, rewrite their metadata as schema2, or repack the immutable version.
The maintainer must retain the original tarball/release.json and recover the
**original uploaded ZIP, immutable artifact ID and GitHub archive digest** from
approved archive storage or the existing Actions artifact API record. Inspect
`gh api repos/todoist/remark-application-links/actions/artifacts/ARTIFACT_ID` and
`gh api repos/todoist/remark-application-links/actions/runs/RUN_ID/attempts/N`, plus
that attempt's upload job logs, to establish which successful reviewed attempt
created that exact artifact. The latest run status is not this evidence.

Compare the original archive digest and its contained tarball/metadata with the
retained copies and any already-published registry bytes. Obtain a separately
reviewed manual recovery procedure explicitly bound to that proven original
attempt, artifact ID and digest, retaining all C03/C05/C08/visibility/latest/auth
guards. If the identity or original bytes cannot be established, stop for the
package owner; do not synthesize a new archive or overwrite/delete/recreate a
published version. Missing old ZIP/receipt release assets require this procedure,
not reconstruction of historical releases. No live recovery is performed during
preparation.

API references: [historical workflow attempts](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt),
[immutable artifact IDs and digests](https://docs.github.com/en/rest/actions/artifacts#get-an-artifact).
