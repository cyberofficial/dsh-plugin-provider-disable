# Usage

## Enabling/Disabling Providers

### Via the Settings UI

1. Open DSH web GUI
2. Navigate to **Settings → Models**
3. You'll see toggle switches for each provider
   - **Enabled**: Provider is active, requests proceed normally
   - **Disabled**: Provider is grayed out in the picker, requests throw `ProviderDisabledError`

### Clicking a Toggle

- Toggle switches between enabled/disabled state
- State is immediately persisted to `$DSH_HOME/provider-disable.json`
- No manual save required — atomic file writes via temp+rename
- Changes take effect immediately for new requests

### Keyboard Accessibility

- Toggles have `aria-pressed` attribute reflecting current state
- Spacebar can toggle the button when focused
- Focus outlines are visible for keyboard navigation

## Picker Graying

### Visual Indication

When a provider is disabled, its group in the model picker is grayed out using:

- **HTML attribute**: `data-provider-disable-off` set on the provider group element
- **CSS styling**: Targets `[data-provider-disable-off]` with reduced opacity/color
- **Identifier matching**: Uses `endsWith('-' + id)` to match hyphenated provider IDs (e.g., `deepseek-official` matches because it ends with `-official`)

### How It Works

1. When state changes, client broadcasts the new disabled set
2. Renderer reads the disabled set and sets `data-provider-disable-off` on matching provider groups
3. CSS automatically applies the grayed appearance
4. The matching uses `providerId.endsWith(`-\${id}`)` against the configured disabled set

### Example

If `deepseek-official` is disabled:
- The picker group with id `deepseek-official` gets `data-provider-disable-off` attribute
- CSS makes that group visually distinct (grayed out)
- The matching works because `deepseek-official`.endsWith(`-official`) is true

## State Persistence

### Where State Is Stored

- File: `$DSH_HOME/provider-disable.json`
- Example path: `C:\Users\[your-user]\.dsh\provider-disable.json` (or `$HOME/.dsh/provider-disable.json` on Linux/macOS)

### File Format

```json
{
  "providers": {
    "deepseek-official": true,
    "nvidia": true
  }
}
```

- `providers`: Object mapping provider IDs to `true` (enabled/disabled status)
- Each key is a provider ID following the `<provider>-<official-name>` pattern
- Values are always `true` (existence in the set means disabled; absence means enabled)

### State Survival Across Restarts

- State persists across `dsh web` restarts
- Survives plugin reinstallation (idempotent)
- To disable additional providers, just toggle them in the UI or edit the JSON directly

### Manual State Editing

If you prefer to edit the JSON directly:

1. Open `$DSH_HOME/provider-disable.json` in any text editor
2. Add or remove provider IDs in the `providers` object
3. Save the file
4. Restart `dsh web` to pick up changes (or they may take effect immediately)

### Example: Fully Disabling DeepSeek and Nvidia

```json
{
  "providers": {
    "deepseek-official": true,
    "nvidia": true
  }
}
```

This disables both the DeepSeek and Nvidia providers entirely.

## One-Shot Runs

One-shot task runs also honor the disabled set:

```powershell
dsh --profile web "my-task-description"
```

Even in one-shot mode, if a disabled provider is encountered, the request will be rejected with a `ProviderDisabledError` and actionable message.

## Known Limits & Constraints

| Limit | Description |
|-------|-------------|
| **Provider-level only** | Only entire providers can be disabled, not individual models |
| **Hyphenated IDs** | Provider IDs using hyphens (e.g., `deepseek-official`) are supported; suffix parsing was fixed via `endsWith()` |
| **No model-level control** | Cannot disable specific models within a provider |
| **CSS graying only** | Visual graying is client-side; host enforcement is the actual security boundary |
| **Slots dependency** | Client toggles require `exports.inject = ['slots']` to wait for the renderer |
| **Cordis guard** | Host must use `ctx.inject(['connection'], cb)` — outer `ctx.connection` is rejected |
| **State format** | JSON must have `providers` object with provider ID keys; other formats may cause errors |
| **Restart required** | Some changes require `dsh web` restart for full effect (especially new provider IDs) |
| **One-shot honored** | `dsh --profile <name> "<task>"` respects the disabled set via the same host listener |

## Troubleshooting

### Toggles Not Appearing in Settings

1. Verify client declares `exports.inject = ['slots']`
2. Ensure `dsh web` was restarted after plugin install
3. Check browser console for errors

### Requests Not Being Rejected

1. Verify the provider ID matches what's in the disabled set
2. Check that `dsh web` is running with the updated bundle
3. Ensure host uses `ctx.inject(['connection'], ...)` pattern

### Picker Not Graying

1. Verify the provider group has the expected ID format
2. Check that `data-provider-disable-off` attribute is being set
3. Confirm CSS rule `[data-provider-disable-off]` is loaded

### State File Not Persisting

1. Verify write permissions on `$DSH_HOME/` directory
2. Check that the JSON is valid (no trailing commas, etc.)
3. Ensure `dsh web` has permission to write to that location