/**
 * Host half of dsh-plugin-provider-disable.
 *
 * Three moving parts:
 *
 * 1. **State** — a tiny JSON document at `$DSH_HOME/provider-disable.json`
 *    (`lib/state.js`) naming provider ids whose model sets are switched off.
 *    Disabling never deletes the provider's API key or settings.
 *
 * 2. **Enforcement** — a listener on the `agent/request` waterfall that
 *    inspects the fully-resolved request config (`provider`/`model`) and
 *    throws when the provider is disabled. The throw surfaces as the turn's
 *    terminal failure, so a disabled provider can never be called even by a
 *    stored session route, a subagent, or a stale model pick.
 *
 * 3. **HTTP surface** — two exact fetch routes on the shared `/api` channel
 *    (registered through the `connection` service once it arrives) the
 *    browser half uses to read and toggle the set. The shared channel already
 *    applies the Host/Origin fence and browser authentication before the
 *    request reaches these handlers.
 *
 * @module dsh-plugin-provider-disable
 */

import { ProviderDisableStore } from './state.js'

/** Plugin name used for the cordis row and log lines. */
export const name = 'dsh-plugin-provider-disable'

/** No hard service deps: `connection` and `llm` arrive via web-app layers. */
export const inject = []

/** Exact fetch route under the shared `/api` prefix. */
export const API_PATH = '/api/plugins/provider-disable/state'

/**
 * Error thrown when a model request targets a disabled provider. The message
 * is what the UI surfaces as the turn's failure, so it names the fix.
 */
export class ProviderDisabledError extends Error {
  /**
   * @param {string} provider - disabled provider route id.
   * @param {string} model - requested model id.
   */
  constructor(provider, model) {
    super(
      `Provider "${provider}" is disabled (model "${model}"): the harness does not`
      + ' send requests to disabled providers. Re-enable it under Settings → Models'
      + ' (toggles provided by dsh-plugin-provider-disable), or pick a model from'
      + ' an enabled provider.',
    )
    this.name = 'ProviderDisabledError'
    this.provider = provider
    this.model = model
  }
}

/**
 * Snapshot for the browser: every provider the host can see, joined with the
 * disabled set. Providers join two host views: the live route list
 * (`llm.listProviders()`) and the configurable directory
 * (`llm.listConfigurableProviders()`), which additionally carries the
 * settings namespace the Models page keys its cards on.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ProviderDisableStore} store
 */
export function describeProviders(ctx, store) {
  const llm = ctx.get('llm')
  const disabled = new Set(store.state.disabled)
  /** @type {Map<string, { id: string, name: string, settingsNs: string }>} */
  const providers = new Map()
  if (llm !== undefined) {
    if (typeof llm.listProviders === 'function') {
      for (const route of llm.listProviders()) {
        if (typeof route?.id === 'string') {
          providers.set(route.id, { id: route.id, name: route.name ?? route.id, settingsNs: '' })
        }
      }
    }
    if (typeof llm.listConfigurableProviders === 'function') {
      for (const entry of llm.listConfigurableProviders()) {
        if (typeof entry?.provider !== 'string') continue
        const current = providers.get(entry.provider)
        providers.set(entry.provider, {
          id: entry.provider,
          name: current?.name ?? entry.displayName ?? entry.provider,
          settingsNs: typeof entry.settingsNs === 'string' ? entry.settingsNs : current?.settingsNs ?? '',
        })
      }
    }
  }
  const list = [...providers.values()].map(provider => ({
    ...provider,
    disabled: disabled.has(provider.id),
  }))
  return {
    providers: list,
    disabled: [...disabled],
    updatedAt: store.state.updatedAt,
  }
}

/**
 * Validate a toggle request body.
 * @param {unknown} body - parsed JSON body.
 * @returns {{ provider: string, disabled: boolean } | null}
 */
export function readToggle(body) {
  if (typeof body !== 'object' || body === null) return null
  const provider = body.provider
  const disabled = body.disabled
  if (typeof provider !== 'string' || provider === '' || typeof disabled !== 'boolean') return null
  return { provider, disabled }
}

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ stateFile?: string, store?: ProviderDisableStore }} [_config]
 *   Optional `stateFile` override, or an injected `store` instance for tests.
 */
export function apply(ctx, _config) {
  const store = _config?.store instanceof ProviderDisableStore
    ? _config.store
    : typeof _config?.stateFile === 'string' && _config.stateFile !== ''
      ? new ProviderDisableStore(_config.stateFile)
      : ProviderDisableStore.atHome()

  // --- Enforcement ---------------------------------------------------------
  //
  // This waterfall resolves the request config; `proposed` carries the exact
  // provider/model the loop is about to call. Throwing aborts the turn before
  // any adapter is prepared, so a disabled provider is unreachable from ANY
  // path (composer pick, stored session route, subagent, `agent.request`).
  ctx.on('agent/request', async (_payload, next) => {
    const proposed = await next()
    if (typeof proposed?.provider === 'string' && store.isDisabled(proposed.provider)) {
      ctx.logger.warn(
        `provider-disable: rejected request to disabled provider "${proposed.provider}"`
        + ` (model "${String(proposed.model)}")`,
      )
      throw new ProviderDisabledError(proposed.provider, String(proposed.model ?? ''))
    }
    return proposed
  })

  // --- HTTP surface --------------------------------------------------------
  //
  // `connection` belongs to a later bundle layer, so wait for it through
  // ctx.inject — which also supplies the Context that *declares* the service.
  // Reaching back for `ctx.connection` on this plugin's own context would trip
  // Cordis's undeclared-dependency guard and leave the route unregistered.
  // The shared /api channel has already applied trust + browser auth by the
  // time `fetch` runs.
  ctx.inject(['connection'], (connCtx) => {
    connCtx.connection.fetch.register({
      path: API_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method === 'GET') {
          return Response.json(describeProviders(connCtx, store))
        }
        let body
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'body must be JSON' }, { status: 400 })
        }
        const toggle = readToggle(body)
        if (toggle === null) {
          return Response.json(
            { error: 'expected { "provider": string, "disabled": boolean }' },
            { status: 400 },
          )
        }
        store.set(toggle.provider, toggle.disabled)
        ctx.logger.info(
          `provider-disable: ${toggle.disabled ? 'disabled' : 'enabled'} provider "${toggle.provider}"`,
        )
        return Response.json(describeProviders(connCtx, store))
      },
    })
    ctx.logger.info(`provider-disable: state endpoint live at ${API_PATH}`)
  })
}
