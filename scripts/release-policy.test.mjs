import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateSourceRun, validatePublicationTag } from './release-policy.mjs'

const selected = 'a'.repeat(40)
const head = 'b'.repeat(40)
const validRun = {
    repository: { full_name: 'todoist/remark-application-links', id: 300606066 },
    head_repository: { full_name: 'todoist/remark-application-links', id: 300606066 },
    workflow_id: 2823705,
    path: '.github/workflows/publish.yml',
    status: 'completed',
    conclusion: 'success',
    event: 'workflow_dispatch',
    display_title: `remark-application-links pack ${selected}`,
    head_branch: 'main',
    head_sha: selected,
}
const comparison = async (base) => ({ status: 'ahead', merge_base_commit: { sha: base } })
const validate = (run, compare = comparison) =>
    validateSourceRun(run, 2823705, selected, '1.0.5', compare)

test('C03 source run maps to exact main checkout and reviewed ancestry', async () => {
    const calls = []
    await validate(validRun, async (base, ref) => {
        calls.push([base, ref])
        return comparison(base)
    })
    assert.deepEqual(calls, [[selected, 'main']])
    for (const patch of [
        { workflow_id: 123 },
        { path: '.github/workflows/other.yml' },
        { status: 'in_progress' },
        { conclusion: 'failure' },
        { event: 'pull_request' },
        { repository: { full_name: 'elsewhere/remark-application-links', id: 300606066 } },
        { head_repository: { full_name: 'todoist/remark-application-links', id: 123 } },
        { head_branch: 'unreviewed' },
        { head_sha: head },
        { display_title: `remark-application-links publish ${selected}` },
    ])
        await assert.rejects(validate({ ...validRun, ...patch }))
    await assert.rejects(
        validate(validRun, async () => ({
            status: 'diverged',
            merge_base_commit: { sha: selected },
        })),
    )
})

test('C06 later reviewed main remains compatible with the original pack run', async () => {
    await validate(validRun, async (base) => ({
        status: 'ahead',
        merge_base_commit: { sha: base },
        head_commit: { sha: head },
    }))
})

test('missing older mirrors cannot downgrade latest; explicit recovery tags preserve its selection', () => {
    assert.throws(() => validatePublicationTag('1.0.5', 'latest', '1.0.6'), /downgrade latest/)
    assert.throws(() => validatePublicationTag('2.9.9', 'latest', '2.10.0'), /downgrade latest/)
    assert.doesNotThrow(() => validatePublicationTag('1.0.5', 'migration-recovery', '3.0.0'))
    assert.doesNotThrow(() => validatePublicationTag('1.0.6', 'latest', '1.0.5'))
    assert.doesNotThrow(() => validatePublicationTag('1.0.5', 'latest', undefined))
    assert.throws(() => validatePublicationTag('1.0.5', '1.0.5', '1.0.6'))
})

// Run the real publisher with a fake npm executable: no registry or authentication calls.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'

function publisherFixture(options = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'remark-application-links-release-test-'))
    mkdirSync(join(dir, 'package'))
    mkdirSync(join(dir, 'bin'))
    const manifest = {
        name: '@todoist/remark-application-links',
        version: '1.0.5',
        main: 'dist/index.js',
        module: 'dist/remark-application-links.esm.js',
        typings: 'dist/index.d.ts',
        engines: { node: '>=12' },
        dependencies: { 'unist-util-flatmap': '^1.0.0', 'unist-util-visit-parents': '^3.1.0' },
        peerDependencies: {},
        repository: 'https://github.com/todoist/remark-application-links',
    }
    writeFileSync(join(dir, 'package/package.json'), JSON.stringify(manifest))
    writeFileSync(join(dir, 'package/README.md'), 'Fixture')
    mkdirSync(join(dir, 'package/dist'))
    const entries = [
        'index.js',
        'index.d.ts',
        'remark-application-links.esm.js',
        'remark-application-links.cjs.development.js',
        'remark-application-links.cjs.production.min.js',
    ]
    for (const entry of entries)
        writeFileSync(join(dir, 'package/dist', entry), '// Test fixture only')
    const filename = 'todoist-remark-application-links-1.0.5.tgz'
    execFileSync('tar', [
        '-czf',
        join(dir, filename),
        '-C',
        dir,
        'package/README.md',
        'package/package.json',
        ...entries.map((entry) => `package/dist/${entry}`),
    ])
    const bytes = readFileSync(join(dir, filename))
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    writeFileSync(
        join(dir, 'release.json'),
        JSON.stringify({
            ...manifest,
            schema: 1,
            sourceRunId: '123',
            filename,
            sourceSha: selected,
            integrity,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
    )
    mkdirSync(join(dir, 'original'))
    for (const file of ['release.json', filename])
        writeFileSync(join(dir, 'original', file), readFileSync(join(dir, file)))
    const state = join(dir, 'state.json')
    writeFileSync(
        state,
        JSON.stringify({
            tags: { latest: '1.0.6' },
            published: false,
            publishes: [],
            errorStream: 'stdout',
            errorCode: 'E404',
            ...options,
            opposite: {
                published: false,
                tags: { latest: '1.0.4' },
                errorStream: 'stdout',
                errorCode: 'E404',
                ...options.opposite,
            },
            commands: [],
            integrity,
        }),
    )
    writeFileSync(
        join(dir, 'bin/npm'),
        `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE))
const config = fs.readFileSync(process.env.NPM_CONFIG_USERCONFIG, 'utf8')
const registry = config.split('\\n').find(line => line.startsWith('registry=')).slice(9)
const destination = registry.includes('npm.pkg.github.com') ? 'github' : 'npmjs'
const copy = destination === process.env.MOCK_SELECTED_DESTINATION ? state : state.opposite
state.commands.push({ args, destination, hasGitHubCredential: Boolean(process.env.GH_PACKAGES_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN), hasGitHubAuthConfig: config.includes('//npm.pkg.github.com/:_authToken=') })
const fail = code => { process[copy.errorStream].write(JSON.stringify({error:{code}})); process.exitCode = 1 }
if (args[0] === 'config') {
    console.log(config.split('\\n').find(line => line.startsWith(args[2] + '=')).split('=').slice(1).join('='))
} else if (args[0] === 'view' && args[2] === 'dist.integrity') {
    if (copy.published) console.log(JSON.stringify(copy.integrity || state.integrity))
    else fail(copy.errorCode)
} else if (args[0] === 'view' && args[2] === 'dist-tags') {
    if (copy.packageErrorCode) fail(copy.packageErrorCode)
    else if (copy.missingPackage && !copy.published) fail(copy.errorCode)
    else console.log(JSON.stringify(copy.tags))
} else if (args[0] === 'login') {
    // Fake login intentionally does not consume stdin; publish may need a fresh challenge.
} else if (args[0] === 'publish') {
    if (state.requireOtp && fs.readFileSync(0, 'utf8') !== 'mock-otp\\n') throw new Error('Publish did not inherit interactive stdin')
    state.publishes.push(args)
    copy.published = true
    copy.tags[args.find(arg => arg.startsWith('--tag=')).slice(6)] = '1.0.5'
} else {
    throw new Error('Unexpected mock npm command')
}
fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state))
`,
        { mode: 0o700 },
    )
    writeFileSync(
        join(dir, 'bin/gh'),
        `#!${process.execPath}
const fs = require('node:fs')
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE))
if (process.argv[2] === 'run' && process.argv[3] === 'download') {
    const path = require('node:path')
    const target = process.argv[process.argv.indexOf('--dir') + 1]
    for (const filename of ['release.json', 'todoist-remark-application-links-1.0.5.tgz'])
        fs.copyFileSync(path.join(path.dirname(process.env.MOCK_STATE), 'original', filename), path.join(target, filename))
    process.exit(0)
}
const path = process.argv[3]
let result
if (path.endsWith('actions/runs/123')) result = ${JSON.stringify(validRun)}
else if (path.endsWith('actions/workflows/publish.yml')) result = {id: 2823705}
else if (path.includes('compare/')) result = {status: 'ahead', merge_base_commit: {sha: '${selected}'}}
else if (path.includes('contents/.github/workflows/publish.yml')) result = {type:'file',path:'.github/workflows/publish.yml',content:Buffer.from('historical workflow; current main may differ').toString('base64')}
else if (path.includes('contents/package.json')) result = {content: Buffer.from(JSON.stringify({name:'@todoist/remark-application-links', version:'1.0.5'})).toString('base64')}
else if (path === 'orgs/todoist/packages/npm/remark-application-links') result = {visibility: state.visibility || 'public', repository:{id:300606066}}
else throw new Error('Unexpected fake GitHub request: ' + path)
console.log(JSON.stringify(result))
`,
        { mode: 0o700 },
    )
    return {
        dir,
        run(tag, destination, command = 'publish', extraEnv = {}) {
            return spawnSync(
                process.execPath,
                [new URL('./release.mjs', import.meta.url).pathname, command, dir, destination],
                {
                    encoding: 'utf8',
                    input: 'mock-otp\n',
                    env: {
                        ...process.env,
                        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
                        MOCK_STATE: state,
                        MOCK_SELECTED_DESTINATION: destination,
                        GITHUB_ACTIONS: '',
                        GH_TOKEN: 'ambient-mock-only',
                        GITHUB_TOKEN: 'ambient-mock-only',
                        ARTIFACT_RUN_ID: '123',
                        RELEASE_SHA: selected,
                        RELEASE_VERSION: '1.0.5',
                        RELEASE_TAG: tag,
                        GH_PACKAGES_TOKEN: 'mock-only',
                        ...extraEnv,
                    },
                },
            )
        },
        state: () => JSON.parse(readFileSync(state)),
        close: () => rmSync(dir, { recursive: true, force: true }),
    }
}

test('actual publisher refuses an older missing mirror before calling npm publish', () => {
    const fixture = publisherFixture()
    try {
        const result = fixture.run('latest', 'npmjs')
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Refusing to downgrade latest/)
        assert.deepEqual(fixture.state().publishes, [])
        assert.equal(fixture.state().tags.latest, '1.0.6')
    } finally {
        fixture.close()
    }
})

for (const destination of ['npmjs', 'github']) {
    test(`actual ${destination} recovery reuses the artifact, preserves latest, and skips a completed mirror`, () => {
        const fixture = publisherFixture()
        try {
            const result = fixture.run('migration-recovery', destination)
            assert.equal(result.status, 0, result.stderr)
            const state = fixture.state()
            assert.equal(state.tags.latest, '1.0.6')
            assert.equal(state.tags['migration-recovery'], '1.0.5')
            assert.equal(state.publishes.length, 1)
            const args = state.publishes[0]
            assert.equal(args[1], join(fixture.dir, 'todoist-remark-application-links-1.0.5.tgz'))
            assert.ok(args.includes('--tag=migration-recovery'))
            assert.ok(args.includes('--provenance=false'))
            assert.ok(args.includes('--ignore-scripts'))
            assert.equal(args.includes('--access=public'), destination === 'npmjs')
            const retry = fixture.run('latest', destination)
            assert.equal(retry.status, 0, retry.stderr)
            assert.equal(fixture.state().publishes.length, 1)
            assert.equal(fixture.state().tags.latest, '1.0.6')
        } finally {
            fixture.close()
        }
    })
}

test('first publication handles stderr-only E404 for version and package-tag lookups', () => {
    const fixture = publisherFixture({ errorStream: 'stderr', missingPackage: true, tags: {} })
    try {
        const result = fixture.run('latest', 'npmjs')
        assert.equal(result.status, 0, result.stderr)
        assert.equal(fixture.state().publishes.length, 1)
        assert.equal(fixture.state().tags.latest, '1.0.5')
    } finally {
        fixture.close()
    }
})

test('stderr-only authentication failure preserves the diagnostic and never publishes', () => {
    const fixture = publisherFixture({ errorStream: 'stderr', errorCode: 'E401' })
    try {
        const result = fixture.run('latest', 'npmjs')
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Registry lookup failed.*E401/)
        assert.deepEqual(fixture.state().publishes, [])
    } finally {
        fixture.close()
    }
})

for (const mode of ['npmjs', 'github', 'bootstrap-npm']) {
    test(`C05 ${mode} rejects differing opposite-registry bytes before login or publication`, () => {
        const fixture = publisherFixture({
            opposite: { published: true, integrity: 'sha512-other-artifact' },
        })
        try {
            const result = fixture.run(
                'migration-recovery',
                mode === 'github' ? 'github' : 'npmjs',
                mode === 'bootstrap-npm' ? mode : 'publish',
            )
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, /different bytes/)
            assert.deepEqual(fixture.state().publishes, [])
            assert.ok(!fixture.state().commands.some(({ args }) => args[0] === 'login'))
        } finally {
            fixture.close()
        }
    })

    test(`C05 ${mode} accepts a matching opposite copy and writes only the missing selected destination`, () => {
        const fixture = publisherFixture({ tags: {}, opposite: { published: true } })
        try {
            const destination = mode === 'github' ? 'github' : 'npmjs'
            const result = fixture.run(
                'latest',
                destination,
                mode === 'bootstrap-npm' ? mode : 'publish',
            )
            assert.equal(result.status, 0, result.stderr)
            const state = fixture.state()
            assert.equal(state.publishes.length, 1)
            assert.ok(
                state.commands
                    .filter(({ args }) => args[0] === 'publish')
                    .every((entry) => entry.destination === destination),
            )
            assert.ok(
                state.commands
                    .filter((entry) => entry.destination === 'npmjs')
                    .every((entry) => !entry.hasGitHubCredential && !entry.hasGitHubAuthConfig),
            )
            assert.ok(
                state.commands
                    .filter((entry) => entry.destination === 'github')
                    .every((entry) => entry.hasGitHubCredential && entry.hasGitHubAuthConfig),
            )
        } finally {
            fixture.close()
        }
    })
}

test('C05 bootstrap checks both missing copies before login and again before inherited-stdio publish', () => {
    const fixture = publisherFixture({ tags: {}, missingPackage: true, requireOtp: true })
    try {
        const result = fixture.run('latest', 'npmjs', 'bootstrap-npm')
        assert.equal(result.status, 0, result.stderr)
        const commands = fixture.state().commands
        const login = commands.findIndex(({ args }) => args[0] === 'login')
        const publish = commands.findIndex(({ args }) => args[0] === 'publish')
        for (const destination of ['npmjs', 'github']) {
            const reads = commands
                .map((entry, index) => ({ ...entry, index }))
                .filter(
                    (entry) =>
                        entry.destination === destination && entry.args[2] === 'dist.integrity',
                )
            assert.ok(reads.some(({ index }) => index < login))
            assert.ok(reads.some(({ index }) => index > login && index < publish))
        }
        assert.equal(fixture.state().publishes.length, 1)
    } finally {
        fixture.close()
    }
})

for (const errorCode of ['E401', 'E403', 'ETIMEDOUT']) {
    test(`C05 opposite-registry ${errorCode} prevents publication`, () => {
        const fixture = publisherFixture({ opposite: { errorCode, errorStream: 'stderr' } })
        try {
            const result = fixture.run('migration-recovery', 'npmjs')
            assert.notEqual(result.status, 0)
            assert.match(result.stderr, new RegExp(errorCode))
            assert.deepEqual(fixture.state().publishes, [])
        } finally {
            fixture.close()
        }
    })
}

test('C05 ambiguous package-level E404 or missing read credential prevents npm bootstrap', () => {
    for (const missingCredential of [false, true]) {
        const fixture = publisherFixture({ opposite: { packageErrorCode: 'E404' } })
        try {
            const result = fixture.run(
                'latest',
                'npmjs',
                'bootstrap-npm',
                missingCredential ? { GH_PACKAGES_TOKEN: '' } : {},
            )
            assert.notEqual(result.status, 0)
            assert.match(
                result.stderr,
                missingCredential ? /GH_PACKAGES_TOKEN/ : /Registry lookup failed.*E404/,
            )
            assert.deepEqual(fixture.state().publishes, [])
            assert.ok(!fixture.state().commands.some(({ args }) => args[0] === 'login'))
        } finally {
            fixture.close()
        }
    }
})

test('C05 matching selected and opposite copies skip both login and publication', () => {
    const fixture = publisherFixture({ published: true, opposite: { published: true } })
    try {
        const result = fixture.run('latest', 'npmjs', 'bootstrap-npm')
        assert.equal(result.status, 0, result.stderr)
        assert.deepEqual(fixture.state().publishes, [])
        assert.ok(!fixture.state().commands.some(({ args }) => args[0] === 'login'))
    } finally {
        fixture.close()
    }
})

test('C05 unexpected mirror visibility blocks every publication', () => {
    const fixture = publisherFixture({ visibility: 'private' })
    try {
        const result = fixture.run('latest', 'npmjs', 'bootstrap-npm')
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /mirror visibility/)
        assert.deepEqual(fixture.state().publishes, [])
    } finally {
        fixture.close()
    }
})

test('C06 unsupported schema stops with original-artifact recovery, without registry writes', () => {
    const fixture = publisherFixture()
    try {
        const file = join(fixture.dir, 'release.json')
        const metadata = JSON.parse(readFileSync(file))
        metadata.schema = 999
        writeFileSync(file, JSON.stringify(metadata))
        const result = fixture.run('latest', 'npmjs')
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /retain the original bytes/)
        assert.deepEqual(fixture.state().publishes, [])
    } finally {
        fixture.close()
    }
})

test('C03 local bootstrap rejects self-declared metadata not retained by the successful run', () => {
    const fixture = publisherFixture()
    try {
        const file = join(fixture.dir, 'release.json')
        const metadata = JSON.parse(readFileSync(file))
        metadata.extra = 'forged metadata'
        writeFileSync(file, JSON.stringify(metadata))
        const result = fixture.run('latest', 'npmjs', 'bootstrap-npm')
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Metadata differs from the original run artifact/)
        assert.deepEqual(fixture.state().publishes, [])
    } finally {
        fixture.close()
    }
})
