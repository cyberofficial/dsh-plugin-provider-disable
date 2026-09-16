# Examples

## Example State File ($DSH_HOME/provider-disable.json)

The state document holds one `disabled` array of provider route ids plus an
`updatedAt` timestamp.

### Minimal Example — Nothing Disabled

```json
{
  "disabled": [],
  "updatedAt": null
}
```

**Description**: The default state — nothing is switched off. Every provider's
models stay in the picker and every request proceeds normally.

### Example 1 — Disable DeepSeek Only

```json
{
  "disabled": ["deepseek-official"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

**Description**: Only the DeepSeek provider is switched off.

- The DeepSeek group is hidden from the model picker
- Requests that resolve to it are rejected with `ProviderDisabledError`
- Every other provider remains fully functional

### Example 2 — Disable Several Providers

```json
{
  "disabled": ["deepseek-official", "nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

**Description**: Two providers off at once. Add ids as needed; omitting a
provider (or removing its id) enables it.

### Example 3 — Re-enable a Provider

```json
{
  "disabled": ["nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

**Description**: After disabling both, this keeps only Nvidia off —
`deepseek-official` was removed from the array, which re-enables it. The
Settings UI does the same thing with its toggle.

### Example 4 — Unknown id Kept

```json
{
  "disabled": ["ollama-local"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

**Description**: Even when the profile no longer defines `ollama-local`, the id
stays recorded. Re-adding a provider under the same id restores its toggle — the
state is never silently pruned.

## Provider IDs

The id is the **provider route id** — the same id `llm.listProviders()`
reports. Some carry a display suffix (`deepseek-official`, `ollama-local`),
others are bare (`nvidia`). You can list the ids the host currently sees with:

```sh
curl -s http://127.0.0.1:3080/api/plugins/provider-disable/state | node -e "
  let raw = '';
  process.stdin.on('data', (chunk) => (raw += chunk));
  process.stdin.on('end', () => {
    const state = JSON.parse(raw);
    for (const provider of state.providers) {
      console.log(`${provider.id}  disabled=${provider.disabled}  ns=${provider.settingsNs}`);
    }
  });
"
```

## ID Matching in the Picker

Group-heading ids look like `:r8q:-deepseek-official` — a React `useId`
prefix, then the provider id. The matcher takes the **longest** `-`-suffix
among the known provider ids, so ids that end with one another cannot
cross-match:

- `:r8q:-nvidia` disabled + `:r1a:-azure-openai` enabled with `openai` also
  disabled → only the `nvidia` group is hidden; `azure-openai` matches its own
  longer id and stays visible
- A typo'd id (`-offical`) matches nothing

## Full Workflow

### Step 1: Read the current state

```sh
curl -s http://127.0.0.1:3080/api/plugins/provider-disable/state
```

### Step 2: Disable a provider

In **Settings → Models**, press `Disable provider` on its card. One click is
one `POST`:

```sh
curl -s -X POST http://127.0.0.1:3080/api/plugins/provider-disable/state \
  -H 'content-type: application/json' \
  -d '{"provider":"nvidia","disabled":true}'
```

### Step 3: Verify the state file

```json
{
  "disabled": ["nvidia"],
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

### Step 4: Observe the picker

- The Nvidia group now carries `data-provider-disable-off` and is hidden
  (`display: none`) from the model picker
- The graying is cosmetic: the host listener is what actually rejects requests

### Step 5: Re-enable

Toggle the card back in Settings, `POST {"provider":"nvidia","disabled":false}`,
or remove the id from the array by hand. Hand edits are read on the next
`dsh web` restart.
