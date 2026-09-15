/**
 * Disabled-provider store: a tiny JSON document under DSH_HOME so the setting
 * survives harness restarts, plus the deterministic normalization rules both
 * the host half and the tests exercise.
 *
 * The store answers plain data only; the HTTP surface lives in the host half
 * (`index.js`) and the UI in the client half (`client.js`).
 *
 * @module dsh-plugin-provider-disable/state
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** State file name below the resolved DSH home. */
export const STATE_FILE_NAME = 'provider-disable.json'

/**
 * Resolve the harness home: `$DSH_HOME`, else `~/.dsh`. Matches the harness's
 * own fallback precedence; whitespace-only overrides are treated as unset.
 * @param {NodeJS.ProcessEnv} [env] - environment to consult.
 * @returns {string} absolute home directory.
 */
export function resolveHome(env = process.env) {
  const override = env.DSH_HOME
  if (typeof override === 'string' && override.trim() !== '') return override
  return join(homedir(), '.dsh')
}

/**
 * Normalize an arbitrary parsed JSON value into the store's shape. Anything
 * unreadable degrades to the empty state rather than failing the boot.
 * @param {unknown} value - parsed JSON.
 * @returns {{ disabled: string[], updatedAt: string | null }}
 */
export function normalizeState(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { disabled: [], updatedAt: null }
  }
  const list = Array.isArray(value.disabled) ? value.disabled : []
  const seen = new Set()
  const disabled = []
  for (const entry of list) {
    if (typeof entry !== 'string' || entry === '' || seen.has(entry)) continue
    seen.add(entry)
    disabled.push(entry)
  }
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null
  return { disabled, updatedAt }
}

/**
 * Flat enable/disable flag flip. Returns a NEW state (callers compare/stash).
 * Unknown ids are kept: a provider the profile later deletes stays recorded so
 * re-adding it under the same id restores the toggle.
 * @param {{ disabled: string[], updatedAt: string | null }} state
 * @param {string} provider
 * @param {boolean} disabled
 * @param {() => string} [now] - ISO-timestamp source (tests inject).
 */
export function setDisabled(state, provider, disabled, now = () => new Date().toISOString()) {
  if (typeof provider !== 'string' || provider === '') {
    throw new TypeError('provider must be a non-empty string')
  }
  const has = state.disabled.includes(provider)
  if (disabled === has) return state
  return {
    disabled: disabled ? [...state.disabled, provider] : state.disabled.filter(id => id !== provider),
    updatedAt: now(),
  }
}

/**
 * A state file bound to a path: load-on-start, atomic write-on-change.
 * Reads are tolerant (missing/corrupt file ⇒ empty state); every write lands
 * through a temp file and rename so a crash mid-write cannot tear the JSON.
 */
export class ProviderDisableStore {
  /**
   * @param {string} file - absolute state file path.
   * @param {() => string} [now] - ISO timestamp source.
   */
  constructor(file, now = () => new Date().toISOString()) {
    this.file = file
    this.now = now
    /** @type {{ disabled: string[], updatedAt: string | null }} */
    this.state = { disabled: [], updatedAt: null }
    this.reload()
  }

  /**
   * Build a store at the default location inside the resolved DSH home.
   * @param {NodeJS.ProcessEnv} [env]
   * @returns {ProviderDisableStore}
   */
  static atHome(env = process.env) {
    return new ProviderDisableStore(join(resolveHome(env), STATE_FILE_NAME))
  }

  /** Re-read the file; a missing/unreadable/corrupt file resets to empty. */
  reload() {
    try {
      this.state = normalizeState(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      this.state = { disabled: [], updatedAt: null }
    }
  }

  /** @returns {boolean} whether the provider id is currently disabled. */
  isDisabled(provider) {
    return this.state.disabled.includes(provider)
  }

  /**
   * Flip one provider's flag and persist when it changed.
   * @param {string} provider
   * @param {boolean} disabled
   * @returns {boolean} whether the persisted state changed.
   */
  set(provider, disabled) {
    const next = setDisabled(this.state, provider, disabled, this.now)
    if (next === this.state) return false
    this.state = next
    this.save()
    return true
  }

  /** Persist atomically (write temp, rename over). */
  save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.file)
  }
}
