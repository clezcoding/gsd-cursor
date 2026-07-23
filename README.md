<div align="center">

# gsd-cursor

**Cursor model profiles for [GSD Core](https://github.com/open-gsd/gsd-core) — as an EoS, not a core patch.**

`max` · `hybrid` · `value` · `budget` — spanning Anthropic, OpenAI, Google Gemini, xAI Grok, Zhipu GLM & Cursor Composer.

![node](https://img.shields.io/badge/node-%3E%3D18-3fb950?style=flat-square)
![gsd](https://img.shields.io/badge/gsd-%3E%3D1.39-f0883e?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

---

## Why this exists

Cursor is a GSD install target, but it sits in **"Group B"** — GSD ships **no built-in tier map** for it, so a bare `runtime: "cursor"` falls back to Claude aliases that Cursor doesn't accept. The only fix is to hand-author `model_profile_overrides.cursor.{opus,sonnet,haiku}` yourself, with zero guidance on which Cursor model fits which agent.

`gsd-cursor` fills that gap **as an EoS (Embeddable Orchestration System)** — per the maintainer directive on [gsd-core#2533](https://github.com/open-gsd/gsd-core/issues/2533) (*"only within the EoS framework, no direct changes to gsd-core"*). It binds the GSD **`model`** interface point and writes model config into your project; it never modifies gsd-core files.

---

## Install

```bash
npm install --global github:clezcoding/gsd-cursor#v1.0.0
gsd-cursor install            # installs the default "hybrid" profile
```

Pick a different profile at install time, or switch anytime:

```bash
gsd-cursor install --profile max      # or hybrid | value | budget
gsd-cursor use value                  # switch later
gsd-cursor status                     # show the active profile
gsd-cursor list                       # print all profiles + tier maps
```

Scope: writes to `./.planning/config.json` when a `.planning/` folder exists (per-project), otherwise `~/.gsd/defaults.json` (global). Force with `--local` / `--global`.

**Uninstall** (removes only the Cursor overrides it added):

```bash
gsd-cursor uninstall && npm uninstall --global gsd-cursor
```

---

## The four profiles

| Profile | Strategy | opus → | sonnet → | haiku → | Vendors | IDs |
|---------|----------|--------|----------|---------|---------|-----|
| **max** | Strongest everywhere | `claude-opus-4-8-thinking-high` | `cursor-grok-4.5-high` | `gpt-5.5-high` | Anthropic · xAI · OpenAI | ✅ verified |
| **hybrid** *(default)* | Plan+review premium, execute value | `claude-opus-4-8-thinking-high` | `composer-2.5` | `gpt-5.3-codex-high` | Anthropic · Cursor · OpenAI | ✅ verified |
| **value** | Best price/performance | `gemini-3-pro` † | `glm-5.2` † | `composer-2.5` | Google · Zhipu · Cursor | † confirm |
| **budget** | Cheapest models only | `glm-5.2` † | `composer-2.5` | `gemini-3.5-flash` † | Zhipu · Cursor · Google | † confirm |

> ### ⚠️ Verification gate († IDs)
> IDs **without** a dagger are verified against Cursor's Cloud-Agents `List Models` API (2026-07-22): `composer-2.5`, `cursor-grok-4.5-high`, `claude-*-thinking-*`, `gpt-*`. IDs marked **†** (`gemini-*`, `glm-*`) come from Cursor's **model picker** / OpenAI-compatible custom-model integration and were **not** in that API list. `gsd-cursor` prints a warning when you install `value`/`budget` — confirm each † model appears in **Cursor → Settings → Models** before running GSD. This is why the **default (`hybrid`) and `max` profiles ship 100 % verified IDs**.

> **GLM 5.2 vs 5.1:** `glm-5.2` is newer, stronger *and* cheaper than `glm-5.1` (~$0.80/$2.51 vs ~$1.40/$4.40). Use 5.2; 5.1 is a legacy swap only.

---

## How `hybrid` works

`hybrid` implements *"plan & review with expensive models, execute with the best price/performance model."* It combines a base profile with GSD's `models` phase-type block:

```json
{
  "runtime": "cursor",
  "model_profile": "balanced",
  "models": { "planning": "opus", "verification": "opus", "execution": "sonnet", "research": "sonnet" },
  "model_profile_overrides": {
    "cursor": { "opus": "claude-opus-4-8-thinking-high", "sonnet": "composer-2.5", "haiku": "gpt-5.3-codex-high" }
  }
}
```

`planning` + `verification` (review) resolve to the `opus` tier → **Opus 4.8**; `execution` + `research` resolve to the `sonnet` tier → **Composer 2.5**. Your own `model_overrides` always win, so per-agent tweaks survive a profile swap.

---

## Registering in the GSD EoS Registry

This EoS is listed via a one-entry docs-PR to gsd-core (`docs/registries/eos.json`), per the [registry README](https://github.com/open-gsd/gsd-core/blob/next/docs/registries/README.md). The prepared entry is in [`registry/eos-entry.json`](registry/eos-entry.json). Before opening that PR you must create the entry's GitHub Discussion thread and paste its URL into the `discussion` field.

---

## License

MIT — see [LICENSE](LICENSE).
