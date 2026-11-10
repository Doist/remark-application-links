import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { validateSourceRun } from './release-policy.mjs'

assert.match(process.env.ARTIFACT_RUN_ID || '', /^\d+$/)
if (process.env.GITHUB_ACTIONS === 'true')
    assert.equal(process.env.GITHUB_REPOSITORY?.toLowerCase(), 'todoist/remark-application-links')
const api = (path) =>
    JSON.parse(
        execFileSync('gh', ['api', `repos/todoist/remark-application-links/${path}`], {
            encoding: 'utf8',
        }),
    )
const run = api(`actions/runs/${process.env.ARTIFACT_RUN_ID}`)
const workflow = api('actions/workflows/publish.yml')
await validateSourceRun(
    run,
    workflow.id,
    process.env.RELEASE_SHA,
    process.env.RELEASE_VERSION,
    async (base, head) => api(`compare/${base}...${head}`),
)
const historicalWorkflow = api(`contents/.github/workflows/publish.yml?ref=${run.head_sha}`)
assert.equal(historicalWorkflow.type, 'file')
assert.equal(historicalWorkflow.path, '.github/workflows/publish.yml')
const manifest = api(`contents/package.json?ref=${run.head_sha}`)
const source = JSON.parse(Buffer.from(manifest.content, 'base64').toString('utf8'))
assert.equal(source.name, '@todoist/remark-application-links')
assert.equal(source.version, process.env.RELEASE_VERSION)
console.log(
    `Validated successful release workflow run ${run.id}: workflow head ${run.head_sha}, selected source ${process.env.RELEASE_SHA}`,
)
