import assert from 'node:assert/strict'

const repository = 'todoist/remark-application-links'
const sha = /^[a-f0-9]{40}$/

export async function requireAncestor(base, head, compare) {
    assert.match(base, sha)
    const result = await compare(base, head)
    assert.ok(['ahead', 'identical'].includes(result.status), `${base} is not in ${head} history`)
    assert.equal(result.merge_base_commit.sha, base)
}

export async function validateSourceRun(
    run,
    workflowId,
    sourceSha,
    version,
    compare,
    runId,
    attempt,
) {
    assert.equal(String(run.id), runId, 'Original run ID mismatch')
    assert.equal(String(run.run_attempt), attempt, 'Original run attempt mismatch')
    assert.match(sourceSha, sha)
    assert.match(version, /^\d+\.\d+\.\d+$/)
    assert.equal(run.repository.full_name.toLowerCase(), repository)
    assert.equal(run.head_repository.full_name.toLowerCase(), repository)
    assert.equal(run.repository.id, 300606066)
    assert.equal(run.head_repository.id, 300606066)
    assert.equal(run.workflow_id, workflowId)
    assert.equal(run.path, '.github/workflows/publish.yml')
    assert.equal(run.status, 'completed')
    assert.equal(run.conclusion, 'success')
    assert.equal(run.event, 'workflow_dispatch')
    // This title comes from GitHub's run-name expression, not the downloaded artifact.
    assert.equal(run.display_title, `remark-application-links pack ${sourceSha}`)
    assert.match(run.head_sha, sha)
    assert.equal(run.head_branch, 'main')
    // Pack always checks out the dispatch commit, with no user-controlled ref override.
    assert.equal(run.head_sha, sourceSha)
    await requireAncestor(run.head_sha, 'main', compare)
    // Do not compare historical workflow bytes to current main: maintenance must not
    // invalidate an original immutable artifact. Its metadata schema is checked separately.
}

export function validateArtifact(artifact, run, artifactId, digest) {
    assert.equal(String(artifact.id), artifactId, 'Original artifact ID mismatch')
    assert.equal(
        artifact.expired,
        false,
        'Original artifact expired; recover original archived bytes, never repack',
    )
    assert.equal(
        artifact.name,
        `remark-application-links-release-${run.id}-${run.run_attempt}`,
        'Original artifact attempt mismatch or legacy unversioned record: follow RELEASING.md original-byte recovery; never repack',
    )
    assert.equal(artifact.digest, digest, 'Original archive digest mismatch')
    assert.equal(artifact.workflow_run?.id, run.id, 'Original artifact run mismatch')
    assert.equal(artifact.workflow_run?.head_sha, run.head_sha, 'Original artifact source mismatch')
    assert.equal(artifact.workflow_run?.head_branch, 'main')
    assert.equal(artifact.workflow_run?.repository_id, 300606066)
    assert.equal(artifact.workflow_run?.head_repository_id, 300606066)
}

export function validatePublicationTag(version, tag, latest) {
    assert.ok(['latest', 'migration-recovery'].includes(tag), 'Select latest or migration-recovery')
    const parts = (value) => {
        assert.match(
            value,
            /^\d+\.\d+\.\d+$/,
            'Unexpected latest version; inspect registry before publishing',
        )
        return value.split('.').map(BigInt)
    }
    const target = parts(version)
    if (tag !== 'latest' || latest === undefined) return
    const current = parts(latest)
    for (let i = 0; i < 3; i++) {
        if (target[i] > current[i]) return
        assert.ok(
            target[i] >= current[i],
            'Refusing to downgrade latest; set RELEASE_TAG=migration-recovery for the missing mirror',
        )
    }
}

export function registryJson(result, allowMissing = true) {
    if (result.status === 0) return JSON.parse(result.stdout)
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    const errorCodes = []
    for (const stream of [result.stdout, result.stderr]) {
        if (!stream) continue
        // npm versions may emit structured errors on either stream, after a text preamble.
        const text = stream.trim()
        const start = text.startsWith('{') ? 0 : text.lastIndexOf('\n{') + 1
        try {
            const failure = JSON.parse(text.slice(start))
            if (failure.error?.code) errorCodes.push(failure.error.code)
        } catch {
            // Unstructured/auth/network errors are failures, never evidence of absence.
        }
    }
    if (allowMissing && errorCodes.length > 0 && errorCodes.every((code) => code === 'E404'))
        return undefined
    throw new Error(
        `Registry lookup failed: ${output || result.error?.message || `exit ${result.status}`}`,
    )
}
