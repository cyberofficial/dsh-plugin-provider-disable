# API Surface

## HTTP Routes

The plugin exposes exact fetch routes on the shared `/api` channel:

### GET /api/plugins/provider-disable/state

**Description**: Retrieve the current disable state.

**Response**:
```json
{
  "providers": {
    "deepseek-official": true,
    "nvidia": true
  }
}
```

- `providers`: Object mapping provider IDs to their disabled status
- If no providers are disabled, returns `{"providers": {}}`

**Use cases**:
- Check which providers are currently disabled
- Read state before making manual modifications
- Debugging and diagnostics

### POST /api/plugins/provider-disable/state

**Description**: Set or update the disable state.

**Request Body** (JSON):
```json
{
  "providers": {
    "deepseek-official": true,
    "nvidia": true
  }
}
```

**Description**: Replace the entire disabled set with the provided object.
- Keys that exist in the request are set to disabled (`true`)
- Keys not included in the request are removed from the disabled set (state is replaced, not merged)
- This is an atomic write via temp+rename pattern

**Use cases**:
- Programmatically disable/enable providers
- API-driven configuration
- Integration with other tools

**Note**: This replaces the entire state object — partial updates must include all desired keys.

## State File Format

### File Location

```
$DSH_HOME/provider-disable.json
```

Typical paths:
- Windows: `C:\Users\%USERNAME%\.dsh\provider-disable.json`
- Linux/macOS: `~/.dsh/provider-disable.json`

### JSON Structure

```json
{
  "providers": {
    "<provider-id>": true,
    "<provider-id>": true
  }
}
```

- **Top-level key**: `providers` (required)
- **Within `providers`**: Object where each key is a provider ID and value is `true`
- **Provider ID format**: `<provider-key>-<official-display-name>`
  - Example: `deepseek-official`, `nvidia`, `ollama-local`

### Example States

#### No Providers Disabled

```json
{
  "providers": {}
}
```

#### One Provider Disabled

```json
{
  "providers": {
    "deepseek-official": true
  }
}
```

#### Multiple Providers Disabled

```json
{
  "providers": {
    "deepseek-official": true,
    "nvidia": true
  }
}
```

## Error Handling

### ProviderDisabledError

When a request is made to a disabled provider, the host throws:

```
ProviderDisabledError: Provider "<provider-id>" is disabled. 
Disable it via Settings → Models or edit $DSH_HOME/provider-disable.json
```

This is the primary security boundary — the UI graying is visual only; the host enforcement actually blocks the request.

## Programmatic Access

### Reading State (Node.js)

```javascript
const fs = require('fs');
const path = require('path');

const statePath = path.join(process.env.HOME || '.dsh', 'provider-disable.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

console.log('Disabled providers:', Object.keys(state.providers));
```

### Modifying State (Node.js)

```javascript
const fs = require('fs');
const path = require('path');

const statePath = path.join(process.env.HOME || '.dsh', 'provider-disable.json');

// Read current state
let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

// Disable a provider
state.providers['deepseek-official'] = true;

// Write atomically (temp + rename pattern used by plugin)
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
```

### Via DSH Commands

**Via the plugin's internal routes** (requires DSH web running):

```powershell
# Check current state (GET equivalent)
# This would be done through the DSH RPC/HTTP interface

# Disable providers (POST equivalent)
dsh plugin --profile web set-provider-disable --providers deepseek-official,nvidia
# (Note: actual CLI shorthand may vary; typically done via Settings UI or direct JSON edit)
```

## Rate Limiting

- No rate limiting on these routes — they are simple read/write operations
- Intended for occasional configuration, not high-frequency access
- Atomic file writes prevent corruption from concurrent writes

## Version Compatibility

- Routes introduced in plugin v1.0.0
- State format is stable across plugin versions
- Older DSH instances may not recognize the routes (will get 404)
- Always restart `dsh web` after modifying the plugin code