/**
 * Client-half test. Loads the checked-in bundle exactly the way the browser
 * module system does (window.__ModuleLoader__.load), mounts it against a jsdom
 * document with a fake context and a fake host route, then asserts the
 * surfaces: settings-card toggles and picker group hiding for disabled
 * providers (including groups that render asynchronously after the menu opens).
 *
 * jsdom and react are test-only deps: a plain `npm install` puts them in this
 * package's node_modules, and inside the plugins workspace a sibling
 * `.test-deps/` install is also accepted. The suite skips cleanly when neither
 * is available.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Require roots to search, most local first: this package's own node_modules,
 * then the workspace's shared `.test-deps`.
 * @type {import('node:module').NodeRequire[]}
 */
const requireRoots = [
  join(here, '..', 'package.json'),
  join(here, '..', '..', '.test-deps', 'package.json'),
]
  .map((path) => {
    try {
      return createRequire(path)
    } catch {
      return undefined
    }
  })
  .filter(Boolean)

/**
 * First require root that can resolve `specifier`.
 * @param specifier - module request.
 * @returns the resolved module, or undefined when no root has it.
 */
function requireFrom(specifier) {
  for (const require of requireRoots) {
    try {
      return require(specifier)
    } catch {
      // Try the next root.
    }
  }
  return undefined
}

/**
 * A require scoped to the package that owns `specifier`, so React and the
 * renderer share one instance (a separate copy breaks the hooks dispatcher and
 * throws a null useSyncExternalStore during SSR).
 * @param specifier - package entry to locate.
 * @returns a require bound to its package, or undefined.
 */
function requireOwnedBy(specifier) {
  for (const require of requireRoots) {
    try {
      return createRequire(require.resolve(specifier))
    } catch {
      // Try the next root.
    }
  }
  return undefined
}

const jsdom = requireFrom('jsdom')
const domRequire = jsdom === undefined ? undefined : requireOwnedBy('react-dom/package.json')
const React = domRequire?.('react')
const ReactDOMServer = domRequire?.('react-dom/server')
const available = Boolean(jsdom && React && ReactDOMServer)

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
      // Mirror the real host: one post flips one toggle in both views.
      const body = JSON.parse(String(init.body))
      const disabled = state.disabled.filter((id) => id !== body.provider)
      if (body.disabled) disabled.push(body.provider)
      const next = {
        ...state,
        providers: state.providers.map((p) => (p.id === body.provider ? { ...p, disabled: body.disabled } : p)),
        disabled,
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

/**
 * One picker group exactly as harness 0.2.1-alpha.2 renders it: the shared
 * MenuGroup primitive emits a bare React `useId` for `aria-labelledby` (no
 * `-<providerId>` suffix) plus a `[data-menu-group-heading]` child carrying the
 * group label.
 * @param label - group heading text.
 * @param headingId - the bare useId shared by aria-labelledby and the heading.
 * @param titles - `title` of every model row in the group.
 * @returns the section markup.
 */
function group(label, headingId, titles) {
  return `<section role="group" aria-labelledby="${headingId}" data-menu-group="">`
    + `<div id="${headingId}" data-menu-group-heading="">${label}</div>`
    + titles.map((title) => `<button role="menuitemradio" title="${title}"></button>`).join('')
    + '</section>'
}

/** Append a `role="menu"` card holding `markup` to the document. */
function menuWith(window, markup) {
  const menu = window.document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.innerHTML = markup
  window.document.body.appendChild(menu)
  return menu
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

  it('hides a disabled provider group identified by its heading text', async () => {
    const { exports, window } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    const { document } = window
    const style = document.head.querySelector('style[data-plugin="dsh-plugin-provider-disable"]')
    assert.ok(style, 'stylesheet injected')
    // Must actually hide, not merely dim, the disabled provider's groups.
    assert.match(style.textContent, /display: none/, 'disabled groups are display:none')

    const menu = menuWith(window, group('DeepSeek', ':r2m:', ['DeepSeek-V4']) + group('nvidia', ':r2s:', ['Kimi K3']))
    // The fixture is the live shape: a bare useId label, no provider suffix.
    assert.equal(menu.querySelectorAll('section')[1].getAttribute('aria-labelledby'), ':r2s:')
    await sleep(250)
    const sections = [...document.querySelectorAll('section[role="group"]')]
    assert.equal(sections.length, 2)
    assert.equal(
      sections[0].hasAttribute('data-provider-disable-off'),
      false,
      'the enabled provider group stays visible',
    )
    assert.equal(
      sections[1].getAttribute('data-provider-disable-off'),
      'true',
      'the disabled provider group is hidden by its heading text',
    )
  })

  it('hides the localized first group as deepseek-account', async () => {
    // `deepseek-account` renders a translated label no snapshot name matches;
    // ModelSelect orders it first, so the menu's FIRST unmatched group is it.
    const state = {
      providers: [
        { id: 'deepseek-account', name: 'DeepSeek Account', settingsNs: 'llm-deepseek', disabled: true },
        { id: 'deepseek-official', name: 'DeepSeek', settingsNs: 'llm-deepseek', disabled: false },
      ],
      disabled: ['deepseek-account'],
      updatedAt: null,
    }
    const { exports, window } = boot(state)
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    menuWith(window, group('DeepSeek 账号', ':r3a:', ['DeepSeek-V4-Pro']) + group('DeepSeek', ':r3b:', ['DeepSeek-V4']))
    await sleep(250)
    const account = window.document.querySelector('section[aria-labelledby=":r3a:"]')
    const official = window.document.querySelector('section[aria-labelledby=":r3b:"]')
    assert.ok(account && official, 'both groups rendered')
    assert.equal(
      account.getAttribute('data-provider-disable-off'),
      'true',
      'the localized account group is hidden by its position',
    )
    assert.equal(
      official.hasAttribute('data-provider-disable-off'),
      false,
      'the enabled group whose heading matches a provider name stays visible',
    )
  })

  it('leaves an unmatched heading alone when the snapshot has no account provider', async () => {
    const { exports, window } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    menuWith(window, group('Some Localized Label', ':r4a:', ['m']) + group('nvidia', ':r4b:', ['Kimi K3']))
    await sleep(250)
    const unmatched = window.document.querySelector('section[aria-labelledby=":r4a:"]')
    assert.equal(
      unmatched.hasAttribute('data-provider-disable-off'),
      false,
      'an unmatched heading is not blamed on a provider the snapshot lacks',
    )
  })

  it('still hides a legacy `-<providerId>` group that carries no heading text', async () => {
    const { exports, window } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    menuWith(
      window,
      '<section role="group" aria-labelledby=":r8q:-deepseek-official"><div class="groupTitle">DeepSeek</div><button role="menuitemradio" title="DeepSeek-V4"></button></section>'
      + '<section role="group" aria-labelledby=":r8q:-nvidia"><div class="groupTitle">nvidia</div><button role="menuitemradio" title="Kimi K3"></button></section>',
    )
    await sleep(250)
    const enabled = window.document.querySelector('section[aria-labelledby=":r8q:-deepseek-official"]')
    const disabled = window.document.querySelector('section[aria-labelledby=":r8q:-nvidia"]')
    assert.ok(enabled && disabled, 'both legacy groups rendered')
    assert.equal(enabled.hasAttribute('data-provider-disable-off'), false)
    assert.equal(disabled.getAttribute('data-provider-disable-off'), 'true', 'legacy suffix identity still works')
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
    container.innerHTML = group('nvidia', ':r1e:', ['Kimi K3'])
    menu.appendChild(container)
    // Wait past the debounced restyle so the late group is still caught.
    await sleep(250)

    const marked = document.querySelector('section[aria-labelledby=":r1e:"]')
    assert.ok(marked, 'async group rendered')
    assert.equal(marked.getAttribute('data-provider-disable-off'), 'true', 'late-rendered disabled group is hidden')
  })

  it('rescues focus off a section before hiding it (selected provider disabled)', async () => {
    const { exports, window } = boot(structuredClone(initialState))
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    const { document } = window

    menuWith(
      window,
      group('DeepSeek', ':r8q:', ['DeepSeek-V4'])
      + '<section role="group" aria-labelledby=":r8r:" data-menu-group="">'
      + '<div id=":r8r:" data-menu-group-heading="">nvidia</div>'
      + '<button role="menuitemradio" title="Kimi K3" aria-checked="true"></button></section>',
    )
    // The picker's drill-in focuses the row of the model in use; that row is
    // inside the group this state marks disabled.
    const current = document.querySelector('button[title="Kimi K3"]')
    current.focus()
    assert.equal(document.activeElement, current, 'focused row sits in the disabled group')
    await sleep(250)

    const section = document.querySelector('section[aria-labelledby=":r8r:"]')
    assert.equal(section.getAttribute('data-provider-disable-off'), 'true', 'group is hidden')
    assert.equal(
      document.activeElement?.getAttribute('title'),
      'DeepSeek-V4',
      'focus lands on a visible row instead of dropping to <body>',
    )
  })

  it('does not hide an enabled provider whose id ends with a disabled id', async () => {
    const state = {
      providers: [
        { id: 'azure-openai', name: 'azure-openai', settingsNs: 'llm-azure', disabled: false },
        { id: 'openai', name: 'openai', settingsNs: 'llm-openai', disabled: true },
      ],
      disabled: ['openai'],
      updatedAt: null,
    }
    const { exports, window } = boot(state)
    const { ctx } = fakeContext()
    exports.apply(ctx)
    await sleep(10)
    menuWith(
      window,
      '<section role="group" aria-labelledby=":r1a:-azure-openai"><div class="groupTitle">azure-openai</div><button role="menuitemradio" title="GPT"></button></section>'
      + '<section role="group" aria-labelledby=":r1b:-openai"><div class="groupTitle">openai</div><button role="menuitemradio" title="GPT-4o"></button></section>',
    )
    await sleep(250)
    const azure = window.document.querySelector('section[aria-labelledby=":r1a:-azure-openai"]')
    const openai = window.document.querySelector('section[aria-labelledby=":r1b:-openai"]')
    assert.ok(azure && openai, 'both groups rendered')
    assert.equal(azure.hasAttribute('data-provider-disable-off'), false, 'a longer id that merely ends with the disabled id stays visible')
    assert.equal(openai.getAttribute('data-provider-disable-off'), 'true', 'the disabled provider itself is hidden')
  })
})
