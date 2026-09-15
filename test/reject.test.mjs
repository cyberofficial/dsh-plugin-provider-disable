/** Host-half tests: request rejection, provider listing, toggle parsing. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  ProviderDisabledError,
  apply,
  describeProviders,
  readToggle,
} from '../lib/index.js'
import { ProviderDisableStore } from '../lib/state.js'

/** Minimal cordis-like context the host half exercises. */
function fakeContext(store) {
  const listeners = new Map()
  const services = new Map()
  const logs = []
  return {
    listeners,
    services,
    logs,
    logger: {
      info: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
    },
    get: (key) => services.get(key),
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    // Services never appear in this fake: inject callbacks never run, which is
    // how the plugin must behave when the harness lacks a connection layer.
    inject: () => undefined,
  }
}

function runRequest(ctx, config) {
  const listener = ctx.listeners.get('agent/request')
  return listener({}, () => Promise.resolve(config))
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'provider-disable-ctx-'))
  const store = new ProviderDisableStore(join(dir, 'state.json'))
  const ctx = fakeContext(store)
  apply(ctx, { store })
  return { ctx, store, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('agent/request enforcement', () => {
  it('passes enabled providers through unchanged', async () => {
    const { ctx, dispose } = harness()
    const config = { provider: 'nvidia', model: 'kimi-k3' }
    assert.equal(await runRequest(ctx, config), config)
    dispose()
  })

  it('rejects a disabled provider with an actionable message', async () => {
    const { ctx, store, dispose } = harness()
    store.set('nvidia', true)
    await assert.rejects(
      runRequest(ctx, { provider: 'nvidia', model: 'kimi-k3' }),
      (error) => {
        assert.ok(error instanceof ProviderDisabledError)
        assert.match(error.message, /provider "nvidia" is disabled/i)
        assert.match(error.message, /kimi-k3/)
        return true
      },
    )
    await runRequest(ctx, { provider: 'deepseek-official', model: 'v4-pro' })
    dispose()
  })
})

describe('describeProviders', () => {
  it('joins routes with the configurable directory and the disabled set', () => {
    const ctx = {
      get: (key) => key !== 'llm' ? undefined : {
        listProviders: () => [{ id: 'nvidia', name: 'nvidia' }],
        listConfigurableProviders: () => [
          { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek' },
          { provider: 'nvidia', displayName: 'nvidia', settingsNs: 'llm-pi-ai' },
        ],
      },
    }
    const store = new ProviderDisableStore(join(mkdtempSync(join(tmpdir(), 'pd-')), 's.json'))
    store.set('nvidia', true)
    const snapshot = describeProviders(ctx, store)
    assert.deepEqual(
      snapshot.providers,
      [
        { id: 'nvidia', name: 'nvidia', settingsNs: 'llm-pi-ai', disabled: true },
        { id: 'deepseek-official', name: 'DeepSeek', settingsNs: 'llm-deepseek', disabled: false },
      ],
    )
    assert.deepEqual(snapshot.disabled, ['nvidia'])
  })

  it('works with the llm service entirely absent', () => {
    const store = new ProviderDisableStore(join(mkdtempSync(join(tmpdir(), 'pd-')), 's.json'))
    const snapshot = describeProviders({ get: () => undefined }, store)
    assert.deepEqual(snapshot.providers, [])
  })
})

describe('readToggle', () => {
  it('accepts a well-formed toggle and rejects everything else', () => {
    assert.deepEqual(readToggle({ provider: 'nvidia', disabled: true }), { provider: 'nvidia', disabled: true })
    assert.equal(readToggle({ provider: 'nvidia' }), null)
    assert.equal(readToggle({ provider: '', disabled: true }), null)
    assert.equal(readToggle(null), null)
    assert.equal(readToggle('nvidia'), null)
  })
})
