import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { validateSourceRun, validateArtifact } from './release-policy.mjs'

assert.match(process.env.ARTIFACT_RUN_ID || '', /^\d+$/)
const recovery =
    'Original attempt, artifact ID and sha256 archive digest required. For legacy unversioned records, retain original ZIP/tarball/release.json and follow RELEASING.md original-byte recovery; never repack a published version'
assert.match(process.env.ARTIFACT_RUN_ATTEMPT || '', /^[1-9]\d*$/, recovery)
assert.match(process.env.ARTIFACT_ID || '', /^[1-9]\d*$/, recovery)
assert.match(process.env.ARTIFACT_DIGEST || '', /^sha256:[a-f0-9]{64}$/, recovery)
if (process.env.GITHUB_ACTIONS === 'true')
    assert.equal(process.env.GITHUB_REPOSITORY?.toLowerCase(), 'todoist/remark-application-links')
const api = (path) =>
    JSON.parse(
        execFileSync('gh', ['api', `repos/todoist/remark-application-links/${path}`], {
            encoding: 'utf8',
        }),
    )
// A later rerun can fail without changing the successful attempt that produced these bytes.
const run = api(
    `actions/runs/${process.env.ARTIFACT_RUN_ID}/attempts/${process.env.ARTIFACT_RUN_ATTEMPT}`,
)
const workflow = api('actions/workflows/publish.yml')
await validateSourceRun(
    run,
    workflow.id,
    process.env.RELEASE_SHA,
    process.env.RELEASE_VERSION,
    async (base, head) => api(`compare/${base}...${head}`),
    process.env.ARTIFACT_RUN_ID,
    process.env.ARTIFACT_RUN_ATTEMPT,
)
const artifact = api(`actions/artifacts/${process.env.ARTIFACT_ID}`)
validateArtifact(artifact, run, process.env.ARTIFACT_ID, process.env.ARTIFACT_DIGEST)
const historicalWorkflow = api(`contents/.github/workflows/publish.yml?ref=${run.head_sha}`)
assert.equal(historicalWorkflow.type, 'file')
assert.equal(historicalWorkflow.path, '.github/workflows/publish.yml')
const manifest = api(`contents/package.json?ref=${run.head_sha}`)
const source = JSON.parse(Buffer.from(manifest.content, 'base64').toString('utf8'))
assert.equal(source.name, '@todoist/remark-application-links')
assert.equal(source.version, process.env.RELEASE_VERSION)
console.log(JSON.stringify({ run, artifact }))
