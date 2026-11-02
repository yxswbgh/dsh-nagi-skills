import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'

import { apply, createProvider, parseSkillDocument } from '../lib/index.js'

const PACKAGED = ['architect', 'de-slop', 'grill', 'prove-it']

test('apply registers the provider and returns its disposer', () => {
  let factory
  let disposed = false
  const ctx = {
    skills: {
      registerProvider(create) {
        factory = create
        return () => {
          disposed = true
        }
      }
    }
  }

  const dispose = apply(ctx)
  assert.equal(typeof factory, 'function')
  assert.equal(typeof dispose, 'function')

  const provider = factory({ signal: new AbortController().signal, invalidate() {} })
  assert.equal(provider.name, 'nagi-skills')
  assert.equal(typeof provider.list, 'function')
  assert.equal(typeof provider.get, 'function')

  dispose()
  assert.equal(disposed, true)
})

test('packaged catalog exposes the four upstream skills', async () => {
  const provider = createProvider()
  const candidates = await provider.list({})

  assert.deepEqual(candidates.map((candidate) => candidate.name), PACKAGED)
  for (const candidate of candidates) {
    assert.ok(candidate.description.length > 20, `${candidate.name} has a description`)
    assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
    assert.equal(candidate.source, 'custom')
    assert.equal(candidate.provider, 'nagi-skills')
    assert.equal(candidate.rank, 550)
    assert.equal(basename(candidate.locator), candidate.name)
    assert.equal(basename(candidate.path), 'SKILL.md')
    assert.match(await readFile(candidate.path, 'utf8'), /^---\n/)
  }
})

test('get returns the body with a directory resource base', async () => {
  const provider = createProvider()
  const candidates = await provider.list({})
  const architect = candidates.find((candidate) => candidate.name === 'architect')
  const definition = await provider.get(architect, {})

  assert.equal(definition.name, 'architect')
  assert.match(definition.content, /^先读需求：/)
  assert.doesNotMatch(definition.content, /^---/)
  assert.deepEqual(definition.resourceBase, { kind: 'directory', path: architect.locator })
  assert.equal(definition.path, architect.path)
  assert.equal(definition.invocation.modelInvocable, true)
})

test('quoted, folded, and invocation fields parse', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nagi-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'demo'))
  await writeFile(
    join(root, 'demo', 'SKILL.md'),
    [
      '---',
      'name: demo',
      'description: >',
      '  line one',
      '  line two',
      'user-invocable: "no"',
      'disable-model-invocation: yes',
      '---',
      '',
      'Body line.',
      ''
    ].join('\n')
  )

  const provider = createProvider({ skillsRoot: root })
  const candidates = await provider.list({})

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'demo')
  assert.equal(candidates[0].description, 'line one line two')
  assert.deepEqual(candidates[0].invocation, {
    modelInvocable: false,
    userInvocable: false
  })

  const definition = await provider.get(candidates[0], {})
  assert.equal(definition.content, 'Body line.\n')
})

test('invalid bundles are skipped instead of registered', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nagi-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const writeSkill = async (directory, contents) => {
    await mkdir(join(root, directory))
    await writeFile(join(root, directory, 'SKILL.md'), contents)
  }

  await writeSkill('no-frontmatter', '# not a skill\n')
  await writeSkill('bad-name', '---\nname: Bad_Name\ndescription: nope\n---\nbody\n')
  await writeSkill('blank-description', '---\nname: blank\ndescription:   \n---\nbody\n')
  await writeSkill('bad-boolean', '---\nname: maybe\ndescription: nope\nuser-invocable: sometimes\n---\nbody\n')
  await writeSkill('valid', '---\nname: valid\ndescription: a valid skill\n---\nbody\n')

  const provider = createProvider({ skillsRoot: root })
  const candidates = await provider.list({})

  assert.deepEqual(candidates.map((candidate) => candidate.name), ['valid'])
})

test('a missing skills root fails loudly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nagi-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const provider = createProvider({ skillsRoot: join(root, 'missing') })
  await assert.rejects(provider.list({}), /cannot read skills directory/)
})

test('get returns undefined when the file disappears after list', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nagi-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'demo'))
  await writeFile(join(root, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: demo skill\n---\nbody\n')

  const provider = createProvider({ skillsRoot: root })
  const [candidate] = await provider.list({})
  await rm(join(root, 'demo'), { recursive: true })

  assert.equal(await provider.get(candidate, {}), undefined)
})

test('BOM and CRLF files parse', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nagi-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'crlf'))
  await writeFile(
    join(root, 'crlf', 'SKILL.md'),
    '\uFEFF---\r\nname: crlf\r\ndescription: CRLF skill\r\n---\r\n\r\nBody.\r\n'
  )

  const provider = createProvider({ skillsRoot: root })
  const [candidate] = await provider.list({})
  const definition = await provider.get(candidate, {})

  assert.equal(candidate.name, 'crlf')
  assert.equal(definition.content, 'Body.\n')
})

test('parseSkillDocument rejects a body without frontmatter', () => {
  assert.equal(parseSkillDocument('# just markdown\n'), undefined)
  assert.equal(parseSkillDocument('---\nname: open\n'), undefined)
})
