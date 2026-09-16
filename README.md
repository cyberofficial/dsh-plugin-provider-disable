# dsh-plugin-provider-disable

Turn a whole provider (a "model set") off without deleting it. Its models
disappear from the composer's model picker, and the host rejects any request that still
targets it — stored session routes and subagents included. API keys, endpoints,
and settings survive untouched; flipping the toggle back restores everything.

A normal, permanently-installed DSH plugin with a host half and a browser half.

<img width="1574" height="176" alt="SmartSelect_20260916_190019_Chrome" src="https://github.com/user-attachments/assets/c24e8d11-c2de-4f93-8666-8b642a2c6950" />


## Why it exists

Settings → Models can add, edit, and delete providers, but there is no way to
say "keep this provider configured, just stop using it right now". Deleting
loses the key and the model list; leaving it enabled means it stays in the
picklist and stale sessions keep reaching for it.

## What it does

- **Settings → Models**: every provider card gains a `Disable provider` /
  `Enable provider` button (registered through the `settings.models.provider-card`
  extension slot — no harness files are patched).
- **Model picker**: a disabled provider's model group is hidden
  (`display:none`) from the composer dropdown, so its rows can't be chosen.
- **Enforcement**: a host listener on the `agent/request` waterfall inspects
  the fully-resolved provider/model and throws before the adapter is prepared,
  so the request never leaves the machine. The turn fails with a message naming
  the provider and the fix. This covers every profile the plugin is installed
  in — the Web UI, one-shot `dsh --profile <name> "<task>"` runs, and subagents
  alike.

Disabled state lives in `$DSH_HOME/provider-disable.json` (default
`~/.dsh/provider-disable.json`) — plain JSON, safe to inspect or edit:

```json
{
  "disabled": ["nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

## Install

```sh
cd dsh-plugin-provider-disable
dsh plugin --profile web install "link:$PWD"
```

Restart `dsh web` afterwards (a profile dependency change is not hot-reloaded),
then reload the page. Both the host route and the browser bundle ship built in
`lib/`, so no compile step is needed.

## How it works

| Piece | Where | Contract |
|---|---|---|
| Toggle store | `lib/state.js` | Atomic JSON file under `$DSH_HOME`; tolerant reads |
| Enforcement | `lib/index.js` → `agent/request` | Throws `ProviderDisabledError` for a disabled provider |
| State API | `lib/index.js` → `GET/POST /api/plugins/provider-disable/state` | Exact fetch route on the shared `/api` channel (already trust- and auth-fenced) |
| Settings toggles | `lib/client.js` → `settings.models.provider-card` | One keyed entry per settings namespace |
| Picker hiding | `lib/client.js` → MutationObserver + `<style>` | Marks each `[role="group"]` section for a disabled provider so the stylesheet hides it |

The provider list comes from the host (`llm.listProviders()` joined with
`llm.listConfigurableProviders()`), so a provider added later appears in the
toggle list on the next state refresh — no plugin update required.

## Notes and limits

- **The toggle is by provider route id**, not by individual model. Disabling
  `nvidia` disables every model it serves; that is the point of a "model set".
- **A disabled provider stays selected in an existing session.** Its turn fails
  with the rejection message until you re-enable it or select another model —
  deliberate, so a stale session cannot silently burn a provider you switched
  off.
- **The picker hiding is cosmetic-plus.** It removes a disabled provider's group
  from view; it is not the security boundary. The host listener is.
- **Provider list changes need a refresh cycle.** When you add a provider while
  the plugin is running, its card toggle appears after the next state fetch
  (opening the picker or the Models page triggers one).
- **One writer assumption.** The state file is written by the harness process
  only; editing it by hand while the harness runs is picked up on next restart.

## Test

```sh
npm test   # state normalization/persistence, request rejection, provider join
```
