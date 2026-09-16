# Installation

## Prerequisites

- A working `dsh` CLI with the `web` profile (`pnpm` on PATH; `corepack enable pnpm` provides it)
- This plugin's directory anywhere on the machine (linked installs read it in place)

## Steps

### Step 1: Install into the web profile

From the plugin directory:

```sh
dsh plugin --profile web install "link:$PWD"
```

`link:` keeps the plugin symlinked, so edits in that directory are what the
harness loads on its next start. Use `file:` instead to install a frozen copy.

### Step 2: Restart the web shell

```sh
dsh web
```

A profile dependency change is not hot-reloaded: the plugin contributes to the
running harness only at startup. Reload the page afterwards.

### Step 3: Verify

1. Open the DSH web GUI
2. Navigate to **Settings → Models** — every provider card now has a
   `Disable provider` button (the state fetch runs on page interactions)
3. Open the composer model picker — a disabled provider's group is hidden

## What Happens During Install

- Installing this package as a profile dependency appends the layer it ships in
  `cordis.patch.yml` automatically (it declares `dsh.bundle`)
- The host half mounts: the `agent/request` enforcement listener plus the
  `GET/POST /api/plugins/provider-disable/state` route on the shared `/api` channel
- The client half registers the settings-card toggles (`settings.models.provider-card`
  slot) and the picker stylesheet + MutationObserver
- The state file `$DSH_HOME/provider-disable.json` is created on first write

## Troubleshooting Installation

- **Toggles missing**: verify the client bundle declares
  `exports.inject = ['slots']` and that `dsh web` was restarted after install
- **Routes missing**: the host registers them through
  `ctx.inject(['connection'], cb)` (reaching for `ctx.connection` directly trips
  the cordis undeclared-dependency guard and never registers)
- **Manual alternative**: if `link:` is not available in your DSH version, use
  `file:"$PWD"` for a frozen copy
