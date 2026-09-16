/**
 * Client-half test. Loads the checked-in bundle exactly the way the browser
 * module system does (window.__ModuleLoader__.load), mounts it against a jsdom
 * document with a fake context and a fake host route, then asserts the
 * surfaces: settings-card toggles and picker group hiding for disabled
 * providers (including groups that render asynchronously after the menu opens).
 *
 * jsdom and react come from the workspace's shared test deps (../../.test-deps);
 * the test skips cleanly when they are unavailable.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))

/** jsdom + react live in the workspace test deps, not inside the plugin bundle. */
const depsRequire = createRequire(join(here, '..', '..', '.test-deps', 'package.json'))

let jsdom
let React
let ReactDOMServer
try {
  jsdom = depsRequire('jsdom')
  // Resolve React and the renderer through react-dom's own scope so components
  // and renderer share one React instance (pnpm keeps a separate copy per
  // package otherwise, which breaks the hooks dispatcher and throws a null
  // useSyncExternalStore during SSR).
  const domRequire = createRequire(join(here, '..', '..', '.test-deps', 'node_modules', 'react-dom', 'package.json'))
  React = domRequire('react')
  ReactDOMServer = domRequire('react-dom/server')
} catch {
  jsdom = undefined
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Boot the bundle against a fresh jsdom document. */
function boot(state) {
  const dom = new jsdom.JSDOM(
    '<!doctype html><html><head></head><body></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  // React DOM reads global document/window; expose the bits the plugin and the
  // renderer consult so the bundle can be evaluated in the jsdom window.
  globalThis.window = window
  globalThis.document = window.document
  globalThis.Node = window.Node
  let registration
  window.__ModuleLoader__ = { load: (entry) => { registration = entry } }
  const requests = []
  window.fetch = async (url, init) => {
    requests.push({ url, init })
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const next = {
        ...state,
        providers: state.providers.map((p) => (p.id === body.provider ? { ...p, disabled: body.disabled } : p)),
      }
      Object.assign(state, next)
    }
    return { ok: true, status: 200, json: async () => state }
  }
  const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  // The bundle is a browser script: give it the jsdom globals it expects.
  const evaluate = new Function('window', 'document', 'Node', 'MutationObserver', 'fetch', 'console', 'setTimeout', source)
  evaluate(window, window.document, window.Node, window.MutationObserver, window.fetch, console, window.setTimeout)
  assert.ok(registration, 'bundle registers itself with the module loader')
  const factory = registration.factory
  const exports = factory((request) => {
    if (request === 'react') return React
    throw new Error(`unexpected external ${request}`)
  })
  return { dom, window, exports, requests, state }
}

/** Minimal context the client half consumes (slots absent: picker-only mode). */
function fakeContext() {
  return {
    ctx: {
      get: () => undefined,
      effect: (fn) => { fn(); return () => {} },
      logger: { info: () => {}, warn: () => {} },
    },
  }
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

  it('fetches the state snapshot on apply', async () => {
    const { exports, requests } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(0)
    assert.equal(requests[0].url, '/api/plugins/provider-disable/state')
  })

  it('renders the disabled and enabled picker groups with the right attribute', async () => {
    const { exports, window } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    const { document } = window
    const style = document.head.querySelector('style[data-plugin="dsh-plugin-provider-disable"]')
    assert.ok(style, 'stylesheet injected')
    // Must actually hide, not merely dim, the disabled provider's groups.
    assert.match(style.textContent, /display: none/, 'disabled groups are display:none')

    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.innerHTML =
      '<section role="group" aria-labelledby=":r8q:-deepseek-official"><div class="groupTitle">DeepSeek</div><button role="menuitemradio" title="DeepSeek-V4"></button></section>' +
      '<section role="group" aria-labelledby=":r8q:-nvidia"><div class="groupTitle">nvidia</div><button role="menuitemradio" title="Kimi K3"></button></section>'
    document.body.appendChild(menu)
    await sleep(250)
    const sections = [...document.querySelectorAll('section[role="group"]')]
    assert.equal(sections.length, 2)
    assert.equal(sections[0].hasAttribute('data-provider-disable-off'), false)
    assert.equal(sections[1].getAttribute('data-provider-disable-off'), 'true')
  })

  it('marks groups that render asynchronously after the menu opens (regression)', async () => {
    const { exports, window } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    const { document } = window

    // The menu appears first, before any model group has loaded.
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    await sleep(20)
    // Each provider's catalog loads on its own schedule; the disabled group
    // lands only after the menu is already open.
    const container = document.createElement('div')
    container.innerHTML =
      '<section role="group" aria-labelledby=":r1e:-nvidia"><div class="groupTitle">nvidia</div><button role="menuitemradio" title="Kimi K3"></button></section>'
    menu.appendChild(container)
    // Wait past the debounced restyle so the late group is still caught.
    await sleep(250)

    const marked = document.querySelector('section[aria-labelledby=":r1e:-nvidia"]')
    assert.ok(marked, 'async group rendered')
    assert.equal(marked.getAttribute('data-provider-disable-off'), 'true', 'late-rendered disabled group is hidden')
  })
})
