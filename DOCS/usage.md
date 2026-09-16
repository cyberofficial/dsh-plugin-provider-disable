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
- **CSS styling**: `section[data-provider-disable-off] { display: none; }` — the group is hidden, not dimmed
- **Identifier matching**: the longest `-`-suffix among the known provider ids; hidden only when that id is disabled

### How It Works

1. The client keeps one cached snapshot from `GET /api/plugins/provider-disable/state`
2. A debounced MutationObserver re-marks every `[role="menu"] section[role="group"][aria-labelledby]` whose heading id ends with a disabled provider id (longest suffix wins)
3. The stylesheet wakes `display: none` for marked groups the moment it is appended

### Example

For a group heading `:r8q:-deepseek-official` while `deepseek-official` is disabled:
- The longest suffix match resolves that group to the disabled id
- The section gets `data-provider-disable-off="true"` and `display: none`
- An enabled `azure-openai` group is not hidden even though `openai` is disabled — the longer id wins

## State Persistence

### Where State Is Stored

- File: `$DSH_HOME/provider-disable.json` — `$DSH_HOME` when set, else `~/.dsh`
- Example path: `C:\Users\[your-user]\.dsh\provider-disable.json` (or `$HOME/.dsh/provider-disable.json` on Linux/macOS)

### File Format

```json
{
  "disabled": ["deepseek-official", "nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

- `disabled`: array of provider route ids currently switched off
- Unknown ids are kept, so re-adding a provider under the same id restores its toggle
- `updatedAt`: ISO timestamp of the last change, or `null` before any change

### State Survival Across Restarts

- State persists across `dsh web` restarts
- Survives plugin reinstallation (idempotent)
- To disable additional providers, just toggle them in the UI or edit the JSON directly

### Manual State Editing

If you prefer to edit the JSON directly:

1. Open `$DSH_HOME/provider-disable.json` in any text editor
2. Add or remove provider ids in the `disabled` array
3. Save the file
4. Restart `dsh web` to pick up changes — the host reads the file at startup and assumes it is the one writer

### Example: Fully Disabling DeepSeek and Nvidia

```json
{
  "disabled": ["deepseek-official", "nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

This turns both providers off entirely.

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
| **Hyphenated IDs** | Ids with hyphens (`deepseek-official`) work; the matcher uses the longest `-`-suffix, so `openai` vs `azure-openai` cannot cross-match |
| **No model-level control** | Cannot disable specific models within a provider |
| **CSS graying only** | Visual graying is client-side; host enforcement is the actual security boundary |
| **Slots dependency** | Client toggles require `exports.inject = ['slots']` to wait for the renderer |
| **Cordis guard** | Host must use `ctx.inject(['connection'], cb)` — outer `ctx.connection` is rejected |
| **State format** | JSON must have a `disabled` array of ids; unreadable or corrupt files degrade to the empty state (no crash at boot) |
| **Restart required** | Hand edits to the state file are read on the next `dsh web` restart; UI toggles take effect immediately |
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