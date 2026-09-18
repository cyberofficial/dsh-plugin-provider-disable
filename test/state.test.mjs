/** State store tests: normalization, toggles, persistence, corruption. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  ProviderDisableStore,
  normalizeState,
  resolveHome,
  setDisabled,
} from '../lib/state.js'

describe('normalizeState', () => {
  it('downgrades junk to the empty state', () => {
    assert.deepEqual(normalizeState(null), { disabled: [], updatedAt: null })
    assert.deepEqual(normalizeState('x'), { disabled: [], updatedAt: null })
    assert.deepEqual(normalizeState([1]), { disabled: [], updatedAt: null })
    assert.deepEqual(normalizeState({ disabled: 'nvidia' }), { disabled: [], updatedAt: null })
  })

  it('keeps string ids once and drops empties', () => {
    const state = normalizeState({ disabled: ['nvidia', 'nvidia', '', 42, 'deepseek-official'], updatedAt: 't' })
    assert.deepEqual(state.disabled, ['nvidia', 'deepseek-official'])
    assert.equal(state.updatedAt, 't')
  })
})

describe('setDisabled', () => {
  const fixed = () => '2026-01-01T00:00:00.000Z'

  it('adds and removes ids, stamping the change', () => {
    let state = normalizeState(null)
    state = setDisabled(state, 'nvidia', true, fixed)
    assert.deepEqual(state.disabled, ['nvidia'])
    assert.equal(state.updatedAt, '2026-01-01T00:00:00.000Z')
    state = setDisabled(state, 'nvidia', false, fixed)
    assert.deepEqual(state.disabled, [])
  })

  it('returns the same object when nothing changes', () => {
    const state = normalizeState(null)
    assert.equal(setDisabled(state, 'nvidia', false, fixed), state)
  })

  it('rejects a blank provider id', () => {
    assert.throws(() => setDisabled(normalizeState(null), '', true), TypeError)
  })
})

describe('ProviderDisableStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-disable-'))
  const file = join(dir, 'nested', 'provider-disable.json')

  it('starts empty without a file and tolerates corruption', () => {
    const store = new ProviderDisableStore(join(dir, 'absent.json'))
    assert.deepEqual(store.state.disabled, [])
    writeFileSync(join(dir, 'bad.json'), 'not json', 'utf8')
    const corrupt = new ProviderDisableStore(join(dir, 'bad.json'))
    assert.deepEqual(corrupt.state.disabled, [])
  })

  it('persists toggles across instances', () => {
    const store = new ProviderDisableStore(file)
    assert.equal(store.set('nvidia', true), true)
    assert.equal(store.isDisabled('nvidia'), true)
    assert.equal(store.set('nvidia', true), false) // no change, no write
    const reloaded = new ProviderDisableStore(file)
    assert.equal(reloaded.isDisabled('nvidia'), true)
    assert.equal(reloaded.isDisabled('deepseek-official'), false)
    assert.equal(reloaded.set('nvidia', false), true)
    assert.equal(new ProviderDisableStore(file).isDisabled('nvidia'), false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('resolveHome', () => {
  it('prefers DSH_HOME, normalized the way the harness normalizes it', () => {
    const absolute = join(tmpdir(), 'x', 'dsh')
    assert.equal(resolveHome({ DSH_HOME: absolute }), absolute)
    // A relative override is resolved against cwd, never returned raw.
    assert.equal(resolveHome({ DSH_HOME: 'relative-dsh' }), resolve('relative-dsh'))
  })

  it('expands a ~-prefixed override rather than creating a literal ~ directory', () => {
    assert.equal(resolveHome({ DSH_HOME: '~' }), resolve(homedir()))
    assert.equal(resolveHome({ DSH_HOME: join('~', 'custom-dsh') }), join(homedir(), 'custom-dsh'))
  })

  it('treats a whitespace-only override as unset and falls back to ~/.dsh', () => {
    const blank = resolveHome({ DSH_HOME: '  ' })
    assert.notEqual(blank, '  ')
    assert.equal(blank, join(homedir(), '.dsh'))
    assert.ok(resolveHome({}).endsWith('.dsh'))
  })
})
