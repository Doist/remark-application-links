import { registryJson, validatePublicationTag } from './release-policy.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command, directory = 'release-artifact', requestedDestination] = process.argv.slice(2)
const destination = command === 'bootstrap-npm' ? 'npmjs' : requestedDestination
const output = resolve(directory)
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
const hash = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding)
const run = (bin, args, options = {}) =>
    execFileSync(bin, args, { encoding: 'utf8', ...options }).trim()

function inspect(tarball) {
    const files = run('tar', ['-tzf', tarball]).split('\n').sort()
    assert.equal(new Set(files).size, files.length, 'Duplicate tar entries')
    for (const file of files)
        assert.match(
            file,
            /^package\/(README\.md|LICENSE|package\.json|src\/(index\.ts|unist-util-flatmap\.d\.ts)|dist\/[a-zA-Z0-9_.-]+)$/,
        )
    for (const entry of run('tar', ['-tvzf', tarball]).split('\n'))
        assert.equal(entry[0], '-', 'Only regular files are allowed in the release tarball')
    for (const file of [
        'index.js',
        'index.d.ts',
        'remark-application-links.esm.js',
        'remark-application-links.cjs.development.js',
        'remark-application-links.cjs.production.min.js',
    ])
        assert.ok(files.includes(`package/dist/${file}`), `Missing built entrypoint: ${file}`)
    const manifest = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json']))
    assert.equal(manifest.name, '@todoist/remark-application-links')
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
    assert.equal(manifest.private, undefined)
    // Routing, visibility and provenance belong to each destination, never the shared tarball.
    assert.equal(manifest.publishConfig, undefined)
    assert.equal(manifest.main, 'dist/index.js')
    assert.equal(manifest.module, 'dist/remark-application-links.esm.js')
    assert.equal(manifest.typings, 'dist/index.d.ts')
    assert.deepEqual(manifest.engines, { node: '>=12' })
    assert.deepEqual(manifest.dependencies, {
        'unist-util-flatmap': '^1.0.0',
        'unist-util-visit-parents': '^3.1.0',
    })
    assert.deepEqual(manifest.peerDependencies, {})
    assert.equal(manifest.repository, 'https://github.com/todoist/remark-application-links')
    for (const key of ['optionalDependencies', 'bundledDependencies']) {
        assert.equal(manifest[key], undefined)
    }
    const bytes = readFileSync(tarball)
    return {
        name: manifest.name,
        version: manifest.version,
        sha256: hash(bytes, 'sha256', 'hex'),
        integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
    }
}

const trustedSource = () =>
    JSON.parse(run(process.execPath, [resolve(root, 'scripts/validate-source-run.mjs')]))
const receipt = ({ run: source, artifact }) => ({
    schema: 1,
    sourceRunId: String(source.id),
    sourceRunAttempt: String(source.run_attempt),
    sourceSha: source.head_sha,
    artifactId: String(artifact.id),
    artifactName: artifact.name,
    archiveDigest: artifact.digest,
})

function inspectArchive(archive, trusted) {
    assert.equal(
        `sha256:${hash(readFileSync(archive), 'sha256', 'hex')}`,
        trusted.artifact.digest,
        'Original archive bytes do not match digest',
    )
    const filename = `todoist-remark-application-links-${process.env.RELEASE_VERSION}.tgz`
    const files = run('unzip', ['-Z1', archive]).split('\n').sort()
    assert.deepEqual(
        files,
        ['release.json', filename].sort(),
        'Unexpected original archive entries',
    )
    return Object.fromEntries(
        files.map((file) => [file, execFileSync('unzip', ['-p', archive, file])]),
    )
}

function verify(trusted) {
    const metadata = json(resolve(output, 'release.json'))
    assert.equal(
        metadata.schema,
        2,
        'Unsupported or legacy artifact schema: retain the original bytes and follow RELEASING.md original-byte recovery; never repack a published version',
    )
    assert.match(process.env.RELEASE_SHA || '', /^[a-f0-9]{40}$/)
    assert.match(process.env.RELEASE_VERSION || '', /^\d+\.\d+\.\d+$/)
    assert.equal(metadata.sourceSha, process.env.RELEASE_SHA)
    assert.match(process.env.ARTIFACT_RUN_ID || '', /^\d+$/)
    assert.equal(metadata.sourceRunId, process.env.ARTIFACT_RUN_ID)
    assert.equal(
        metadata.sourceRunAttempt,
        process.env.ARTIFACT_RUN_ATTEMPT,
        'Metadata original attempt mismatch',
    )
    assert.equal(metadata.version, process.env.RELEASE_VERSION)
    assert.equal(metadata.filename, `todoist-remark-application-links-${metadata.version}.tgz`)
    const tarball = resolve(output, metadata.filename)
    const actual = inspect(tarball)
    for (const key of Object.keys(actual)) assert.equal(metadata[key], actual[key])
    // Bind local bytes to the immutable uploaded ZIP and its independently retained identity.
    assert.deepEqual(
        json(resolve(output, 'artifact.json')),
        receipt(trusted),
        'Retained artifact identity mismatch',
    )
    const entries = inspectArchive(resolve(output, 'artifact.zip'), trusted)
    assert.deepEqual(
        JSON.parse(entries['release.json'].toString('utf8')),
        metadata,
        'Metadata differs from the original run artifact',
    )
    assert.ok(
        entries[metadata.filename].equals(readFileSync(tarball)),
        'Tarball differs from the original run artifact',
    )
    return { metadata, tarball }
}

if (command === 'pack') {
    assert.equal(
        process.env.GITHUB_ACTIONS,
        'true',
        'Release artifacts must originate in the pack workflow',
    )
    assert.equal(process.env.GITHUB_REPOSITORY, 'todoist/remark-application-links')
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main')
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch')
    assert.match(process.env.GITHUB_RUN_ID || '', /^\d+$/)
    assert.match(process.env.GITHUB_RUN_ATTEMPT || '', /^[1-9]\d*$/)
    assert.equal(
        run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }),
        '',
        'Commit reviewed source before packing',
    )
    const sourceSha = run('git', ['rev-parse', 'HEAD'], { cwd: root })
    assert.equal(sourceSha, process.env.GITHUB_SHA)
    if (process.env.RELEASE_SHA) {
        assert.match(process.env.RELEASE_SHA, /^[a-f0-9]{40}$/)
        assert.equal(sourceSha, process.env.RELEASE_SHA)
    }
    mkdirSync(output, { recursive: true })
    assert.deepEqual(
        readdirSync(output),
        [],
        'Use an empty directory; retain any existing artifact',
    )
    const [packed] = JSON.parse(
        run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
            cwd: root,
        }),
    )
    const metadata = {
        schema: 2,
        ...inspect(resolve(output, packed.filename)),
        sourceSha,
        sourceRunId: process.env.GITHUB_RUN_ID,
        sourceRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
        filename: packed.filename,
    }
    writeFileSync(resolve(output, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`)
    console.log(JSON.stringify(metadata, null, 2))
} else if (command === 'download') {
    const trusted = trustedSource()
    mkdirSync(output, { recursive: true })
    assert.deepEqual(
        readdirSync(output),
        [],
        'Use an empty directory; never replace retained bytes',
    )
    const temporary = mkdtempSync(resolve(tmpdir(), 'remark-original-'))
    try {
        const archive = resolve(temporary, 'artifact.zip')
        try {
            writeFileSync(
                archive,
                execFileSync(
                    'gh',
                    [
                        'api',
                        `repos/todoist/remark-application-links/actions/artifacts/${process.env.ARTIFACT_ID}/zip`,
                    ],
                    { maxBuffer: 20 * 1024 * 1024 },
                ),
            )
        } catch {
            throw new Error(
                'Cannot retrieve original archive: retain original bytes and follow RELEASING.md original-byte recovery; never repack a published version',
            )
        }
        const entries = inspectArchive(archive, trusted)
        for (const [name, bytes] of Object.entries(entries))
            writeFileSync(resolve(output, name), bytes, { flag: 'wx' })
        writeFileSync(resolve(output, 'artifact.zip'), readFileSync(archive), { flag: 'wx' })
        writeFileSync(
            resolve(output, 'artifact.json'),
            `${JSON.stringify(receipt(trusted), null, 2)}\n`,
            { flag: 'wx' },
        )
        console.log(JSON.stringify(verify(trusted).metadata, null, 2))
    } finally {
        rmSync(temporary, { recursive: true, force: true })
    }
} else if (command === 'verify') {
    console.log(JSON.stringify(verify(trustedSource()).metadata, null, 2))
} else if (command === 'publish' || command === 'bootstrap-npm') {
    if (command === 'bootstrap-npm')
        assert.notEqual(
            process.env.GITHUB_ACTIONS,
            'true',
            'First publication needs an interactive maintainer',
        )
    assert.ok(['npmjs', 'github'].includes(destination), 'Select exactly one destination')
    const { metadata, tarball } = verify(trustedSource())
    assert.ok(
        process.env.GH_PACKAGES_TOKEN,
        'GH_PACKAGES_TOKEN with read access to the transferred public mirror is required for both-registry preflight',
    )
    const isolated = mkdtempSync(resolve(tmpdir(), 'remark-application-links-publish-'))
    try {
        // Separate directories/configs prevent scope or credentials from crossing registries.
        const baseEnv = Object.fromEntries(
            Object.entries(process.env).filter(
                ([key]) =>
                    !/^(npm_config_|node_auth_token$|npm_token$|gh_packages_token$|gh_token$|github_token$)/i.test(
                        key,
                    ),
            ),
        )
        const contexts = Object.fromEntries(
            Object.entries({
                npmjs: 'https://registry.npmjs.org/',
                github: 'https://npm.pkg.github.com/',
            }).map(([name, registry]) => {
                const cwd = resolve(isolated, name)
                mkdirSync(cwd)
                const env = { ...baseEnv }
                const auth =
                    name === 'github'
                        ? '//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}\n'
                        : ''
                if (name === 'github') env.GH_PACKAGES_TOKEN = process.env.GH_PACKAGES_TOKEN
                const userconfig = resolve(cwd, 'user.npmrc')
                const globalconfig = resolve(cwd, 'global.npmrc')
                writeFileSync(
                    userconfig,
                    `registry=${registry}\n@todoist:registry=${registry}\n${auth}`,
                    { mode: 0o600 },
                )
                writeFileSync(globalconfig, '')
                Object.assign(env, {
                    NPM_CONFIG_USERCONFIG: userconfig,
                    NPM_CONFIG_GLOBALCONFIG: globalconfig,
                })
                const options = { cwd, env }
                assert.equal(run('npm', ['config', 'get', '@todoist:registry'], options), registry)
                assert.equal(run('npm', ['config', 'get', 'registry'], options), registry)
                return [name, { registry, options }]
            }),
        )
        const spec = `${metadata.name}@${metadata.version}`
        const lookup = (name, target, field, allowMissing = true) => {
            const { registry, options } = contexts[name]
            return registryJson(
                spawnSync('npm', ['view', target, field, '--json', `--registry=${registry}`], {
                    encoding: 'utf8',
                    ...options,
                }),
                allowMissing,
            )
        }
        const preflight = () => {
            // This public mirror already exists and must transfer with the organization.
            // Require independent visibility and repository linkage evidence before any write.
            const mirror = JSON.parse(
                run('gh', ['api', 'orgs/todoist/packages/npm/remark-application-links'], {
                    env: { ...baseEnv, GH_TOKEN: process.env.GH_PACKAGES_TOKEN },
                }),
            )
            assert.equal(
                mirror.visibility,
                'public',
                'Resolve GitHub mirror visibility before publication',
            )
            assert.equal(
                mirror.repository?.id,
                300606066,
                'Resolve GitHub mirror repository linkage',
            )
            // Readable package metadata proves package access;
            // a package-level E404 could hide missing rights and must never authorize a write.
            const githubTags = lookup('github', metadata.name, 'dist-tags', false)
            assert.ok(
                githubTags && typeof githubTags === 'object' && !Array.isArray(githubTags),
                'Cannot establish GitHub package read access',
            )
            return Object.fromEntries(
                ['npmjs', 'github'].map((name) => {
                    const integrity = lookup(name, spec, 'dist.integrity')
                    if (integrity !== undefined)
                        assert.equal(
                            integrity,
                            metadata.integrity,
                            `Existing ${name} copy has different bytes; retain the original artifact and stop`,
                        )
                    return [name, integrity]
                }),
            )
        }
        let copies = preflight()
        const { registry, options } = contexts[destination]
        if (copies[destination] === undefined && command === 'bootstrap-npm') {
            execFileSync('npm', ['login', '--auth-type=web', `--registry=${registry}`], {
                ...options,
                stdio: 'inherit',
            })
            // Interactive login may take time; check both copies again before publication.
            copies = preflight()
        }
        const view = () =>
            spawnSync('npm', ['view', spec, 'dist.integrity', '--json', `--registry=${registry}`], {
                encoding: 'utf8',
                ...options,
            })
        const tags = () => {
            const result = spawnSync(
                'npm',
                ['view', metadata.name, 'dist-tags', '--json', `--registry=${registry}`],
                { encoding: 'utf8', ...options },
            )
            const value = registryJson(result)
            if (value === undefined) return {}
            assert.ok(
                value && typeof value === 'object' && !Array.isArray(value),
                'Invalid registry tags',
            )
            return value
        }
        const existing = copies[destination]
        if (existing !== undefined) {
            assert.equal(
                existing,
                metadata.integrity,
                'Existing version has different bytes; stop for operator review',
            )
            console.log(`${spec} already matches on ${destination}; no publication needed`)
        } else {
            const tag = process.env.RELEASE_TAG || 'latest'
            const previousTags = tags()
            validatePublicationTag(metadata.version, tag, previousTags.latest)
            const args = [
                'publish',
                tarball,
                '--ignore-scripts',
                `--tag=${tag}`,
                `--registry=${registry}`,
                '--provenance=false',
            ]
            if (destination === 'npmjs') args.push('--access=public')
            // GitHub visibility is checked above and managed independently; --access is npm-only.
            execFileSync('npm', args, { ...options, stdio: 'inherit' })
            const published = view()
            assert.equal(
                published.status,
                0,
                'Publish may have succeeded: inspect registry before retrying',
            )
            assert.equal(JSON.parse(published.stdout), metadata.integrity)
            const currentTags = tags()
            assert.equal(
                currentTags[tag],
                metadata.version,
                'Verify the selected registry tag before continuing',
            )
            if (tag !== 'latest')
                assert.equal(
                    currentTags.latest,
                    previousTags.latest,
                    'latest changed during recovery; inspect concurrent releases',
                )
            console.log(`${spec} verified on ${destination}`)
        }
    } finally {
        rmSync(isolated, { recursive: true, force: true })
    }
} else {
    throw new Error(
        'Usage: node scripts/release.mjs pack|download|verify DIRECTORY, publish DIRECTORY npmjs|github, or bootstrap-npm DIRECTORY',
    )
}
