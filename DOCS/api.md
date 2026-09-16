# API Surface

## HTTP Routes

The plugin exposes one exact fetch route on the shared `/api` channel. That
channel applies the Host/Origin fence and browser authentication before a
request reaches this handler, so the browser half needs no extra auth.

### GET /api/plugins/provider-disable/state

**Description**: Retrieve the current state — every provider the host can see,
joined with the disabled set.

**Response**:
```json
{
  "providers": [
    { "id": "deepseek-official", "name": "DeepSeek", "settingsNs": "llm-deepseek", "disabled": false },
    { "id": "nvidia", "name": "nvidia", "settingsNs": "llm-pi-ai", "disabled": true }
  ],
  "disabled": ["nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

- `providers`: array. It is the join of `llm.listProviders()` with
  `llm.listConfigurableProviders()`; `settingsNs` is the settings namespace the
  Models page keys its cards on (empty when the host cannot determine one).
- `disabled`: provider route ids currently switched off. Unknown ids are kept,
  so re-adding a deleted provider under the same id restores its toggle.
- `updatedAt`: ISO timestamp of the last change, or `null`.

**Use cases**: read which providers are disabled, render toggle UIs, diagnostics.

### POST /api/plugins/provider-disable/state

**Description**: Toggle ONE provider.

**Request Body** (JSON):
```json
{ "provider": "nvidia", "disabled": true }
```

- `provider`: provider route id, a non-empty string.
- `disabled`: the desired flag.

**Response**: the same snapshot shape as GET, reflecting the change (HTTP 200).

**Errors** (HTTP 400):
- body is not JSON → `{ "error": "body must be JSON" }`
- malformed body → `{ "error": "expected { \"provider\": string, \"disabled\": boolean }" }`

**Note**: this is a single toggle, not a replace-all. One POST flips one id.

## State File

### File Location

```
$DSH_HOME/provider-disable.json
```

Resolved by `resolveHome()` in `lib/state.js`: `$DSH_HOME` when set
(whitespace-only counts as unset), otherwise `~/.dsh`.

Typical paths:
- Windows: `C:\Users\%USERNAME%\.dsh\provider-disable.json`
- Linux/macOS: `~/.dsh/provider-disable.json`

### JSON Structure

```json
{
  "disabled": ["nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

- `disabled`: array of provider route ids. Unknown ids are kept — a provider the
  profile later deletes stays recorded, so re-adding it under the same id
  restores the toggle.
- `updatedAt`: ISO timestamp of the last change, or `null` before any change.

Reads are tolerant: a missing, unreadable, or corrupt file degrades to the empty
state (`{ "disabled": [], "updatedAt": null }`). Writes land through a temp
file and rename, so a crash mid-write cannot tear the JSON.

### Example States

Nothing disabled:

```json
{
  "disabled": [],
  "updatedAt": null
}
```

Nvidia disabled:

```json
{
  "disabled": ["nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Several ids:

```json
{
  "disabled": ["nvidia", "ollama-local"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

## Enforcement

The host listens on the `agent/request` waterfall. Once the request config
resolves, a provider id in the disabled set throws:

```text
ProviderDisabledError: Provider "nvidia" is disabled (model "<model-id>"): the
harness does not send requests to disabled providers. Re-enable it under
Settings → Models (toggles provided by dsh-plugin-provider-disable), or pick a
model from an enabled provider.
```

The throw surfaces as the turn's terminal failure before any adapter is
prepared, so it covers every path — composer pick, stored session route,
subagent, and one-shot `dsh --profile <name> "<task>"` runs. The picker graying
is cosmetic; this listener is the security boundary.

## Programmatic Access (Node.js)

Reading, with the same resolution precedence the store uses:

```javascript
const fs = require('fs')
const path = require('path')

const home = process.env.DSH_HOME || path.join(process.env.HOME ?? '', '.dsh')
const statePath = path.join(home, 'provider-disable.json')

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
console.log('Disabled providers:', state.disabled.join(', '))
```

Toggling the way the store does (tolerant read, atomic write):

```javascript
const { mkdirSync } = require('fs')

function toggle(provider, disabled, now = new Date().toISOString()) {
  let state = { disabled: [], updatedAt: null }
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    // Missing or corrupt: start from the empty state, as the store does.
  }
  if (state.disabled.includes(provider) === disabled) return state
  const next = {
    disabled: disabled
      ? [...state.disabled, provider]
      : state.disabled.filter((id) => id !== provider),
    updatedAt: now,
  }
  mkdirSync(path.dirname(statePath), { recursive: true })
  const tmp = `${statePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(tmp, statePath)
  return next
}

toggle('nvidia', true)
```

The harness process is the one writer; hand edits while it runs are picked up on
the next restart.

## Notes

- No rate limiting on the route — this is occasional configuration traffic.
- Atomic file writes prevent torn JSON; a torn file degrades to empty on read.
- State survives `dsh web` restarts and plugin reinstalls.
- Routes ship with plugin v0.1.0. The state format
  (`{ disabled: [...], updatedAt }`) is stable, and `normalizeState` degrades
  older or corrupt shapes to the empty state rather than failing the boot.
