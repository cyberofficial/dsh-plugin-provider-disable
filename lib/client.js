/**
 * Client half of dsh-plugin-provider-disable.
 *
 * Two surfaces, both reading one cached state snapshot fetched from the host
 * route the package's host half mounts on the shared /api channel:
 *
 * 1. Settings → Models: a per-provider Enable/Disable toggle inside every
 *    provider card (keyed slot `settings.models.provider-card`, registered
 *    once per known settings namespace).
 * 2. The composer model picker: a MutationObserver and a tiny stylesheet gray
 *    out every group section whose provider is disabled and mark its buttons
 *    `aria-disabled`, so disabled providers look and feel unselectable. The
 *    host half still rejects any request that slips through (stored sessions,
 *    subagents), which is the actual enforcement.
 *
 * Authored in plain ES (no JSX) so the checked-in bundle needs no build step.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-provider-disable',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const name = 'dsh-plugin-provider-disable'

    /** Host route both the GET snapshot and POST toggle ride. */
    const STATE_PATH = '/api/plugins/provider-disable/state'

    /** DOM marker the observer sets on a disabled provider's picker section. */
    const DISABLED_ATTR = 'data-provider-disable-off'

    /**
     * Shared snapshot cache. One object so the toggle components and the
     * menu observer always agree; `listeners` is the pub/sub for React.
     */
    const cache = {
      /** @type {{ providers: Array, disabled: string[], updatedAt: string | null } | null} */
      snapshot: null,
      fetchedAt: 0,
      inflight: null,
      /** @type {Set<() => void>} */
      listeners: new Set(),
    }

    const notify = () => {
      for (const listener of [...cache.listeners]) {
        try { listener() } catch { /* a dead component must not break the rest */ }
      }
    }

    /**
     * Fetch the snapshot; concurrent callers share one request. Within
     * `minAgeMs` of the last successful fetch, return the cached copy.
     */
    async function fetchState(minAgeMs = 2000) {
      if (cache.snapshot !== null && Date.now() - cache.fetchedAt < minAgeMs) return cache.snapshot
      if (cache.inflight !== null) return cache.inflight
      cache.inflight = (async () => {
        const response = await fetch(STATE_PATH, { headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error(`state fetch failed: ${response.status}`)
        const body = await response.json()
        cache.snapshot = body
        cache.fetchedAt = Date.now()
        notify()
        restyle()
        return body
      })()
      try {
        return await cache.inflight
      } catch (error) {
        console.warn('dsh-plugin-provider-disable:', error)
        return cache.snapshot
      } finally {
        cache.inflight = null
      }
    }

    /** Toggle one provider and refresh the shared snapshot. */
    async function setProviderDisabled(provider, disabled) {
      const response = await fetch(STATE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ provider, disabled }),
      })
      if (!response.ok) throw new Error(`toggle failed: ${response.status}`)
      cache.snapshot = await response.json()
      cache.fetchedAt = Date.now()
      notify()
      restyle()
      return cache.snapshot
    }

    /** React subscription to the shared snapshot. */
    function useSnapshot() {
      const read = () => cache.snapshot
      return React.useSyncExternalStore(
        (listener) => {
          cache.listeners.add(listener)
          return () => cache.listeners.delete(listener)
        },
        read,
        read,
      )
    }

    /**
     * One provider card's toggle row. Props come from the
     * `settings.models.provider-card` slot owner: `{ provider: { provider,
     * displayName, settingsNs }, configured, keyConfigured }`.
     */
    function ProviderToggle(props) {
      const provider = props?.provider
      const id = provider?.provider
      const snapshot = useSnapshot()
      const [busy, setBusy] = React.useState(false)
      if (id === undefined || snapshot === null) return null
      const row = snapshot.providers.find((p) => p.id === id)
      // A provider the host does not list (e.g. an unsaved draft card) has no
      // toggle state yet — render nothing rather than a wrong button.
      if (row === undefined) return null
      const disabled = row.disabled === true
      const label = disabled
        ? `Provider disabled — models hidden from the picker. Enable`
        : `Disable this provider: hides its models in the picker and rejects requests`
      const onClick = async () => {
        setBusy(true)
        try {
          await setProviderDisabled(id, !disabled)
        } catch (error) {
          console.warn('dsh-plugin-provider-disable:', error)
        } finally {
          setBusy(false)
        }
      }
      return React.createElement(
        'div',
        { className: 'provider-disable-row' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'provider-disable-toggle' + (disabled ? ' is-off' : ''),
            disabled: busy,
            'aria-pressed': disabled,
            title: label,
            onClick,
          },
          busy ? '…' : disabled ? 'Enable provider' : 'Disable provider',
        ),
        disabled
          ? React.createElement(
            'span',
            { className: 'provider-disable-note' },
            'Models are hidden and requests are rejected.',
          )
          : null,
      )
    }

    /**
     * Settings-card registration. The slot is keyed by the row's settings
     * namespace; an adapter family shares one namespace across its providers
     * (e.g. every pi-ai route lives under `llm-pi-ai`), so we register one
     * entry per namespace the host reports. Namespaces discovered later (a
     * newly added custom provider) register once that snapshot arrives.
     *
     * A namespace is recorded as registered only once `slots.register` actually
     * returned, and its disposer is collected in `disposers`. Recording before
     * the call would retire a namespace whose registration threw — the usual
     * cause being a snapshot that arrives before the settings slot is declared —
     * and the later declaration-time pass would then skip it forever.
     * @param {Set<string>} registeredNamespaces - namespaces already registered.
     * @param {Array<() => void>} disposers - collects each entry's disposer.
     */
    function registerCardEntries(slots, registeredNamespaces, disposers) {
      const snapshot = cache.snapshot
      if (snapshot === null) return
      for (const provider of snapshot.providers) {
        const ns = provider.settingsNs
        if (typeof ns !== 'string' || ns === '' || registeredNamespaces.has(ns)) continue
        try {
          const dispose = slots.register({ name: 'settings.models.provider-card', key: ns }, ProviderToggle)
          registeredNamespaces.add(ns)
          disposers.push(dispose)
        } catch (error) {
          console.warn('dsh-plugin-provider-disable: card registration failed for', ns, error)
        }
      }
    }

    // --- Model picker graying ----------------------------------------------
    //
    // The picker is a closed component (no per-group slot), so the visual
    // layer is a stylesheet + attribute toggle: each group section carries
    // `aria-labelledby="<useId>-<providerId>"`, and provider ids cannot end
    // with "-" + another id, so a suffix test is unambiguous.

    /** @returns {string[]} currently disabled provider ids (empty before first fetch). */
    function disabledIds() {
      return cache.snapshot === null ? [] : cache.snapshot.disabled
    }

    /**
     * Provider id a picker group belongs to, or ''. The group heading id is
     * `<useId>-<providerId>`; a React `useId` carries no hyphen, while provider
     * ids contain hyphens themselves (`deepseek-official`). Match by the
     * LONGEST `-`-suffix among every known provider id — not only the disabled
     * set — so one id that is a suffix of another (`openai` vs
     * `azure-openai`) cannot cross-match, and the true owner always wins the
     * longest match. The winner counts only when it sits in the disabled set.
     */
    function disabledProviderFor(labelId) {
      const candidates = new Set(disabledIds())
      const snapshot = cache.snapshot
      if (snapshot !== null) {
        for (const provider of snapshot.providers) {
          if (typeof provider?.id === 'string') candidates.add(provider.id)
        }
      }
      let best = ''
      for (const id of candidates) {
        if (id !== '' && id.length > best.length && labelId.endsWith(`-${id}`)) best = id
      }
      return disabledIds().includes(best) ? best : ''
    }

    /** (Re)mark every menu section under document. Runs after every relevant DOM mutation. */
    function restyle() {
      const sections = document.querySelectorAll('[role="menu"] section[role="group"][aria-labelledby]')
      for (const section of sections) {
        const label = section.getAttribute('aria-labelledby') ?? ''
        if (label !== '' && disabledProviderFor(label) !== '') section.setAttribute(DISABLED_ATTR, 'true')
        else section.removeAttribute(DISABLED_ATTR)
      }
    }

    /** Stylesheet masking a disabled provider's picker group. */
    const CSS = `
section[${DISABLED_ATTR}] { display: none; }
.provider-disable-row { display: flex; align-items: center; gap: 8px; padding-top: 8px; }
.provider-disable-toggle {
  font: inherit; font-size: 12px; line-height: 1.4; padding: 4px 10px; border-radius: 6px;
  border: 1px solid var(--color-border, rgba(127,127,127,0.4));
  background: transparent; color: inherit; cursor: pointer;
}
.provider-disable-toggle:hover { opacity: 0.85; }
.provider-disable-toggle.is-off {
  background: var(--color-surface-raised, rgba(127,127,127,0.12));
}
.provider-disable-note { font-size: 12px; opacity: 0.7; }
`

    /** Wire the style element + observer; the returned disposer removes both. */
    function watch() {
      const style = document.createElement('style')
      style.setAttribute('data-plugin', name)
      style.textContent = CSS
      document.head.appendChild(style)
      // Debounce so async group rendering (each provider catalog loads after
      // the menu opens) is caught: restyle re-scans in-menu group sections a
      // beat after any content inside a picker menu changes, not just when the
      // menu element itself is first added.
      let restyleTimer = 0
      const scheduleRestyle = () => {
        if (restyleTimer !== 0) return
        restyleTimer = window.setTimeout(() => {
          restyleTimer = 0
          restyle()
        }, 120)
      }
      // True when the node is part of an open picker menu (itself a role=menu,
      // or a descendant of one, e.g. a model group later filled in async).
      const inPickerMenu = (el) =>
        (typeof el.matches === 'function' && el.matches('[role="menu"]')) ||
        (typeof el.closest === 'function' && (el.closest('[role="menu"]') ?? null) !== null)
      const observer = new MutationObserver((records) => {
        // A picker menu opened: refresh state (cheap when warm), then restyle.
        let sawMenu = false
        for (const record of records) {
          if (record.type !== 'childList') continue
          for (const node of record.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue
            if (inPickerMenu(node)) { scheduleRestyle(); sawMenu = true }
          }
        }
        if (sawMenu) void fetchState().then(() => restyle())
      })
      observer.observe(document.body, { childList: true, subtree: true })
      return () => {
        observer.disconnect()
        style.remove()
      }
    }

    function apply(ctx) {
      // First fetch ignites the whole UI; every later re-fetch re-registers
      // any newly discovered settings namespaces.
      void fetchState()
      // `slots` is a declared dependency (see `inject` below), so the Loader
      // only applies this plugin once the renderer provides the service; the
      // guard keeps the picker half alive in a composition without it.
      const slots = ctx.get('slots')
      const registeredNamespaces = new Set()
      /** Disposers for the card entries currently registered (drained on collapse). */
      const cardDisposers = []
      if (slots !== undefined) {
        const registerAll = () => registerCardEntries(slots, registeredNamespaces, cardDisposers)
        // The injection effect's callback owns one declaration lifetime: it
        // registers against the current snapshot and returns the teardown the
        // renderer runs when the declaration collapses. Returning nothing would
        // leak the entries and leave `registeredNamespaces` claiming namespaces
        // whose entries no longer exist, so a later declaration — the renderer
        // re-declaring after an HMR reload — would re-register none of them.
        slots.inject('settings.models.provider-card', () => {
          registerAll()
          return () => {
            for (const dispose of cardDisposers.splice(0)) {
              try {
                dispose()
              } catch {
                // The declaration is already gone; nothing left to withdraw.
              }
            }
            registeredNamespaces.clear()
          }
        })
        cache.listeners.add(registerAll)
        ctx.effect(() => () => cache.listeners.delete(registerAll))
      } else {
        console.warn('dsh-plugin-provider-disable: slots service unavailable; provider toggles not registered')
      }
      ctx.effect(watch)
    }

    exports.name = name
    // Wait for the renderer's slot registry: without the declaration this
    // plugin could apply before `slots` exists and silently register nothing.
    exports.inject = ['slots']
    exports.apply = apply
    return exports
  },
})
