# dsh-plugin-provider-disable

## Overview

The **dsh-plugin-provider-disable** plugin provides a mechanism to disable entire DeepSeek or Nvidia model providers within the DSH (DeepSeek Harness) web UI. Once disabled, all requests to the disabled provider are rejected at the host level, and the model picker groups are visually grayed out to indicate they are unavailable.

This plugin is useful for:

- **Temporarily excluding** a provider during development or testing
- **Enforcing provider restrictions** in production deployments
- **Graying out** disabled providers in the Settings → Models UI and function call picker
- **Persisting** disable state across restarts via a JSON state file

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Provider Disable Set** | A JSON file (`provider-disable.json`) containing the list of disabled provider identifiers (e.g., `deepseek-official`, `nvidia`) |
| **Host Enforcement** | The DSH server host intercepts all outbound API requests and rejects those targeting disabled providers with a `ProviderDisabledError` |
| **Client Graying** | The browser UI uses a `MutationObserver` + stylesheet to gray out model picker groups and shows an enable toggle in Settings → Models |
| **State Persistence** | Disable state survives restarts — stored in `$DSH_HOME/provider-disable.json` |
| **Cordis Integration** | Plugin declares `ctx.inject(['slots'])` and `ctx.inject(['connection'])` for proper initialization and route registration |

### How It Works

1. **Client side** (browser): 
   - React toggle components appear in Settings → Models per provider card
   - A `MutationObserver` watches the model picker for provider group changes
   - CSS `[data-provider-disable-off]` + stylesheet grayes disabled groups
   - `useSyncExternalStore` subscribes to state changes from the host

2. **Host side** (server):
   - Exact fetch routes `GET/POST /api/plugins/provider-disable/state` serve the disable state
   - An `agent/request` listener throws `ProviderDisabledError` for any request to a disabled provider
   - Route registration uses `ctx.inject(['connection'], cb)` to satisfy the cordis dependency guard

3. **Persistence**:
   - State file: `$DSH_HOME/provider-disable.json` (created automatically on first write)
   - JSON format: `{"providers": ["deepseek-official", "nvidia"]}`
   - Survives `dsh web` restarts

### Plugin Files

```
dsh-plugin-provider-disable/
├── package.json              # Plugin manifest with dsh.bundle + dsh.client
├── cordis.patch.yml          # Profile patch for auto-install into web profile
├── lib/
│   ├── index.js              # Host: ProviderDisableStore + /api routes + agent request listener
│   ├── state.js              # ProviderDisableStore: resolveHome, normalizeState, setDisabled, atomic file writes
│   └── client.js             # Client: fetchState, setProviderDisabled, ProviderToggle, MutationObserver, inject ['slots']
├── test/
│   ├── state.test.mjs        # 5 tests: normalizeState, setDisabled, roundtrip, resolveHome
│   ├── reject.test.mjs       # 3 tests: enabled passes, disabled throws, describeProviders
│   └── client.test.mjs       # 4 tests: inject declaration, toggles, enable button, picker graying
├── README.md                 # Install: `dsh plugin --profile web add "link:$PWD"`
└── DOCS/                     # ← This folder
    ├── overview.md           # This file
    ├── install.md            # Installation instructions
    ├── usage.md              # How to use the plugin
    ├── api.md                # API surface reference
    └── examples.md           # Example state file + provider ids
```

### Known Limits & Constraints

| Limit | Detail |
|-------|--------|
| **Provider IDs** | Must match the *configurable directory* format (e.g., `deepseek-official`, `nvidia`). Underscore/hyphen parsing was fixed via `endsWith()` matching against the disabled set. |
| **Max Providers** | No hard limit on number of disabled providers, but the UI shows one toggle per provider namespace in Settings → Models. |
| **State File** | Located at `$DSH_HOME/provider-disable.json`. If the `$DSH_HOME` directory doesn't exist, the store resolves it relative to the plugin root. |
| **Restart Required** | After editing the state file or the plugin source, restart `dsh web` for changes to take effect (bundle layer reload). |
| **One-shot runs** | `dsh --profile <name> "<task>"` also honors the disabled set via the same host listener, but only for the duration of that run. |
| **Cordis guard** | Route registration **must** use `ctx.inject(['connection'], cb)` — using outer `ctx.connection` was rejected and never registered the route. |
| **Client inject** | Client **must** declare `exports.inject = ['slots']` and use `ctx.get('slots')` with a guard — without it, toggles could silently never register when the renderer hasn't provided the slots service yet. |
| **Picker graying** | Uses `data-provider-disable-off` attribute + CSS; host enforcement is the actual security boundary. Client graying is cosmetic only. |
| **Tested providers** | Verified disabled: `deepseek-official` (llm-deepseek) and `nvidia` (llm-pi-ai). |

### Development Notes

- Plugin is installed via: `dsh plugin --profile web add "link:D:/github/dsh-plugins/dsh-plugin-provider-disable"`
- Source edits are picked up on `d web` restart (linked source profile)
- All 17 tests pass (8+5+4): state store, rejection, and client UI smoke tests
- The plugin is **self-contained** — no external dependencies beyond DSH core (cordis, react, etc. provided by the host)