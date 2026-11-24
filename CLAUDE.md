## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (cebollinos11/sword) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Testing the Delver Floor generator

When working on the dungeon (Delver Floor) generator (`src/sim/delver/`), test it in the Map Editor and with the AI check, not by playing a Run: it is much faster. See "Testing the generator" in `docs/plans/delver.md`.
