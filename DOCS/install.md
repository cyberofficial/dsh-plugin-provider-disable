# Installation

## Prerequisites

- DSH (DeepSeek Harness) web profile running
- Plugin directory at: `D:\github\dsh-plugins\dsh-plugin-provider-disable`
- DSH MCP bridge connected to your instance

## Installation Steps

### Step 1: Ensure the plugin directory exists

The plugin should already be present at:
```
D:\github\dsh-plugins\dsh-plugin-provider-disable\
```

If not, clone or copy the plugin files into this location.

### Step 2: Add the plugin to your web profile

Run the following command from the plugin directory (or with appropriate path access):

```powershell
dsh plugin --profile web add "link:$PWD"
```

Where `$PWD` is the full path to the plugin directory, e.g.:

```powershell
dsh plugin --profile web add "link:D:\github\dsh-plugins\dsh-plugin-provider-disable"
```

### Step 3: Verify installation

- Check that the plugin appears in your profile's loaded plugins
- Restart `dsh web` so the new bundle layer takes effect
- The toggles should appear in **Settings → Models**

### Step 4: Manual alternative (if link: syntax fails)

If the `link:$PWD` syntax doesn't work in your DSH version, you can:

1. Copy the plugin directory into your DSH profiles folder
2. Or use the profile's `cordis.patch.yml` mechanism as described in the README

## What Happens During Install

- The `cordis.patch.yml` profile patch layer auto-inserts the plugin configuration
- The plugin's `package.json` declares `dsh.bundle.patch` and `dsh.client`
- Host routes (`/api/plugins/provider-disable/state`) are registered
- Client toggles become available in the Settings UI
- State file `$DSH_HOME/provider-disable.json` is created on first write

## Verifying the Plugin is Active

After restarting `dsh web`:

1. Open the DSH web GUI
2. Navigate to **Settings → Models**
3. You should see disable toggles for each provider
4. Picker groups should have graying active for disabled providers

## Known Installation Issues

- **Inject guard**: If client toggles don't appear, verify the client file declares `exports.inject = ['slots']`
- **Cordis connection**: If host routes aren't registered, ensure `ctx.inject(['connection'], ...)` is used (not outer `ctx.connection`)
- **0-byte fetch**: The initial token exchange may return 0 bytes on first call (unrelated to plugin, noted in README)