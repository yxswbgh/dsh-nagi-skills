/**
 * dsh-nagi-skills — Nagi Studio's agent skills as a DeepSeek Harness plugin.
 *
 * A Cordis Host plugin that registers one skill provider into the global layer
 * of `ctx.skills`. The four skill bodies stay on disk under
 * `skills/<name>/SKILL.md`; `list()` reads frontmatter to build the catalog and
 * `get()` reads the body on demand, so an edited body is served on the next
 * load.
 *
 * Upstream: https://github.com/nagi-studio/skills (MIT)
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name; the bundle row asserts this package. */
export const name = 'dsh-nagi-skills'

/** The Host service this plugin cannot activate without. */
export const inject = ['skills']

/** Provider label stored on every candidate. */
const PROVIDER = 'nagi-skills'
/** Source bucket exposed by skill summaries. */
const SOURCE = 'custom'
/**
 * Registry rank. User roots rank 500, so a user-authored skill wins a duplicate
 * name; the deployment's bundled root ranks 600, so packaged skills win there.
 */
const RANK = 550
/** DSH skill names are kebab-case. */
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const DEFAULT_SKILLS_ROOT = fileURLToPath(new URL('../skills', import.meta.url))

/** Normalize a BOM and CRLF line endings before parsing. */
function normalize(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return withoutBom.replace(/\r\n?/g, '\n')
}

/** Strip one layer of matching single or double quotes. */
function unquote(value) {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if (first !== last || (first !== '"' && first !== "'")) return value
  const inner = value.slice(1, -1)
  if (first === "'") return inner.replace(/''/g, "'")
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/**
 * Parse a SKILL.md document into frontmatter metadata and body.
 *
 * Supports the scalar fields DSH consumes plus YAML folded (`>`) and literal
 * (`|`) blocks. A document without a `---` block is not a skill.
 *
 * @param text - raw SKILL.md contents.
 * @returns `{ metadata, body }`, or undefined when no frontmatter block exists.
 */
export function parseSkillDocument(text) {
  const lines = normalize(text).split('\n')
  if (lines[0].trim() !== '---') return undefined

  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].replace(/\s+$/, '') === '---') {
      closing = index
      break
    }
  }
  if (closing === -1) return undefined

  const metadata = {}
  let key
  let style
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index]
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (key === undefined || style === undefined) continue
      const continuation = line.trim()
      if (continuation === '') continue
      metadata[key] = style === 'folded'
        ? (metadata[key] ? `${metadata[key]} ${continuation}` : continuation)
        : (metadata[key] ? `${metadata[key]}\n${continuation}` : continuation)
      continue
    }

    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(line)
    if (match === null) {
      key = undefined
      style = undefined
      continue
    }

    key = match[1]
    let value = (match[2] ?? '').trim()
    if (value === '>' || value === '>-' || value === '>+') {
      style = 'folded'
      value = ''
    } else if (value === '|' || value === '|-' || value === '|+') {
      style = 'literal'
      value = ''
    } else {
      style = undefined
      value = unquote(value)
    }
    metadata[key] = value
  }

  const body = lines.slice(closing + 1).join('\n').replace(/^\n+/, '')
  return { metadata, body }
}

/** Read a YAML-ish boolean using the spellings DSH accepts. */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  switch (value.trim().toLowerCase()) {
    case 'true':
    case 'yes':
    case 'on':
    case '1':
      return true
    case 'false':
    case 'no':
    case 'off':
    case '0':
      return false
    default:
      return undefined
  }
}

/**
 * Resolve DSH invocation flags from frontmatter.
 * @returns the invocation policy, or undefined for a rejected spelling.
 */
function resolveInvocation(metadata) {
  let modelInvocable = true
  let userInvocable = true

  const disableModel = metadata['disable-model-invocation']
  if (disableModel !== undefined) {
    const parsed = parseBoolean(disableModel)
    if (parsed === undefined) return undefined
    modelInvocable = !parsed
  }

  const user = metadata['user-invocable']
  if (user !== undefined) {
    const parsed = parseBoolean(user)
    if (parsed === undefined) return undefined
    userInvocable = parsed
  }

  return { modelInvocable, userInvocable }
}

/**
 * Read and validate one SKILL.md file.
 * @param skillFile - absolute path to SKILL.md.
 * @param signal - optional cancellation.
 * @returns the parsed skill, or undefined when the file is absent or invalid.
 */
async function readSkill(skillFile, signal) {
  let text
  try {
    text = await readFile(skillFile, 'utf8')
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined
    throw error
  }
  if (signal?.aborted) return undefined

  const parsed = parseSkillDocument(text)
  if (parsed === undefined) return undefined

  const skillName = typeof parsed.metadata.name === 'string' ? parsed.metadata.name.trim() : ''
  const description = typeof parsed.metadata.description === 'string'
    ? parsed.metadata.description.trim()
    : ''
  if (!SKILL_NAME.test(skillName) || description === '') return undefined

  const invocation = resolveInvocation(parsed.metadata)
  if (invocation === undefined) return undefined

  return {
    name: skillName,
    description,
    invocation,
    metadata: parsed.metadata,
    content: parsed.body
  }
}

/** Build the catalog candidate for one parsed skill. */
function toCandidate(skill, skillDir, skillFile, providerName) {
  const whenToUse = skill.metadata.whenToUse
  return {
    name: skill.name,
    description: skill.description,
    ...(typeof whenToUse === 'string' && whenToUse.trim() !== ''
      ? { whenToUse: whenToUse.trim() }
      : {}),
    invocation: skill.invocation,
    source: SOURCE,
    provider: providerName,
    rank: RANK,
    locator: skillDir,
    path: skillFile,
    metadata: skill.metadata
  }
}

/** Discover directory-bundle skills under one root. */
async function discover(skillsRoot, signal, providerName) {
  let entries
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true })
  } catch (error) {
    throw new Error(
      `nagi-skills: cannot read skills directory "${skillsRoot}"; reinstall the plugin if the package is incomplete`,
      { cause: error }
    )
  }

  const candidates = []
  for (const entry of entries) {
    if (signal?.aborted) break
    if (!entry.isDirectory()) continue
    const skillDir = join(skillsRoot, entry.name)
    const skillFile = join(skillDir, 'SKILL.md')
    const skill = await readSkill(skillFile, signal)
    if (skill === undefined) continue
    candidates.push(toCandidate(skill, skillDir, skillFile, providerName))
  }

  return candidates.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Create the packaged skill provider.
 *
 * @param options.skillsRoot - directory holding `<name>/SKILL.md` bundles.
 * @param options.providerName - provider label registered on `ctx.skills`.
 */
export function createProvider(options = {}) {
  const skillsRoot = options.skillsRoot ?? DEFAULT_SKILLS_ROOT
  const providerName = options.providerName ?? PROVIDER

  return {
    name: providerName,
    async list(lookup = {}) {
      return discover(skillsRoot, lookup.signal, providerName)
    },
    async get(candidate, lookup = {}) {
      if (candidate === undefined || typeof candidate.path !== 'string') return undefined
      const skill = await readSkill(candidate.path, lookup.signal)
      if (skill === undefined) return undefined
      const skillDir = typeof candidate.locator === 'string'
        ? candidate.locator
        : dirname(candidate.path)
      return {
        ...toCandidate(skill, skillDir, candidate.path, providerName),
        resourceBase: { kind: 'directory', path: skillDir },
        content: skill.content
      }
    }
  }
}

/**
 * Register the provider in the Host layer of the skill registry.
 * Returning the disposer keeps teardown ordered with the plugin fiber.
 */
export function apply(ctx) {
  return ctx.skills.registerProvider(() => createProvider())
}

export default { name, inject, apply }
