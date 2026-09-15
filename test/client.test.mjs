/**
 * Client-half smoke test. Loads the checked-in bundle exactly the way the
 * browser module system does (`window.__ModuleLoader__.load`), mounts it
 * against a jsdom document with a fake `slots` service and a fake host route,
 * then asserts the two surfaces: settings-card toggles and picker graying.
 *
 * jsdom and react come from the harness checkout (the plugin has no
 * dependencies of its own); the test skips cleanly when that checkout is
 * unavailable.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const HARNESS = 'D:/github/deepseek-harness/package.json'
const harnessRequire = createRequire(HARNESS)
// pnpm keeps react reachable only from packages that declare it; any client
// package works as the anchor.
const reactRequire = createRequire('D:/github/deepseek-harness/packages/client/ui-model-selection/package.json')

let jsdom
let React
let ReactDOMServer
try {
  jsdom = harnessRequire('jsdom')
  React = reactRequire('react')
  ReactDOMServer = reactRequire('react-dom/server')
} catch {
  jsdom = undefined
}

/** Boot the bundle against a fresh jsdom document. */
function boot(state) {
  const dom = new jsdom.JSDOM(
    '<!doctype html><html><head></head><body></body></html>',
    { url: 'http://127.0.0.1:3080/' },
  )
  const { window } = dom
  let registration
  window.__ModuleLoader__ = { load: (entry) => { registration = entry } }
  const requests = []
  window.fetch = async (url, init) => {
    requests.push({ url, init })
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const next = { ...state, providers: state.providers.map(p => p.id === body.provider ? { ...p, disabled: body.disabled } : p) }
      Object.assign(state, next)
    }
    return { ok: true, status: 200, json: async () => state }
  }
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  // The bundle is a browser script: give it the jsdom globals it expects.
  const evaluate = new Function('window', 'document', 'Node', 'MutationObserver', 'fetch', 'console', source)
  evaluate(window, window.document, window.Node, window.MutationObserver, window.fetch, console)
  assert.ok(registration, 'bundle registers itself with the module loader')
  const factory = registration.factory
  const exports = factory((request) => {
    if (request === 'react') return React
    throw new Error(`unexpected external ${request}`)
  })
  return { dom, window, exports, requests, state }
}

/** Minimal `slots`/context the client half consumes. */
function fakeContext() {
  const registered = []
  const effects = []
  const ctx = {
    get: (key) => key === 'slots' ? slots : undefined,
    effect: (fn) => { effects.push(fn()); return () => {} },
    logger: { info: () => {}, warn: () => {} },
  }
  const slots = {
    inject: (name, callback) => { callback(); return () => {} },
    register: (options, Component) => {
      registered.push({ options, Component })
      return () => {}
    },
  }
  return { ctx, registered, effects }
}

const initialState = {
  providers: [
    { id: 'deepseek-official', name: 'DeepSeek', settingsNs: 'llm-deepseek', disabled: false },
    { id: 'nvidia', name: 'nvidia', settingsNs: 'llm-pi-ai', disabled: true },
  ],
  disabled: ['nvidia'],
  updatedAt: null,
}

const maybe = jsdom === undefined ? describe.skip : describe

maybe('client bundle', () => {
  it('declares the slots dependency so the Loader applies it after the renderer', () => {
    const { exports } = boot(structuredClone(initialState))
    assert.deepEqual(exports.inject, ['slots'])
    assert.equal(exports.name, 'dsh-plugin-provider-disable')
    assert.equal(typeof exports.apply, 'function')
  })

  it('registers one settings-card toggle per provider settings namespace', async () => {
    const { exports, requests } = boot(structuredClone(initialState))
    const { ctx, registered } = fakeContext()
    exports.apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(requests[0].url, '/api/plugins/provider-disable/state')
    assert.deepEqual(
      registered.map(entry => entry.options),
      [
        { name: 'settings.models.provider-card', key: 'llm-deepseek' },
        { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
      ],
    )
  })

  it('renders an Enable button for a disabled provider and toggles it', async () => {
    const { exports } = boot(structuredClone(initialState))
    const { ctx, registered } = fakeContext()
    exports.apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    const Toggle = registered.find(entry => entry.options.key === 'llm-pi-ai').Component
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Toggle, { provider: { provider: 'nvidia' }, configured: true, keyConfigured: true }),
    )
    assert.match(html, /Enable provider/)
    assert.match(html, /aria-pressed="true"/)
  })

  it('grays the picker group of a disabled provider and leaves enabled ones alone', async () => {
    const { exports, window } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    const { document } = window
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.innerHTML = `
      <section role="group" aria-labelledby=":r8q:-deepseek-official">
        <div class="groupTitle">DeepSeek</div>
        <button role="menuitemradio" title="DeepSeek-V4-Pro"></button>
      </section>
      <section role="group" aria-labelledby=":r8q:-nvidia">
        <div class="groupTitle">nvidia</div>
        <button role="menuitemradio" title="Kimi K3"></button>
      </section>`
    document.body.appendChild(menu)
    await new Promise(resolve => setTimeout(resolve, 5))
    const sections = document.querySelectorAll('section[role="group"]')
    assert.equal(sections[0].hasAttribute('data-provider-disable-off'), false)
    assert.equal(sections[1].getAttribute('data-provider-disable-off'), 'true')
    assert.ok(document.head.querySelector('style[data-plugin="dsh-plugin-provider-disable"]'))
  })
})
