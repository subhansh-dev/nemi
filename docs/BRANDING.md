# Nemi branding

## Name

**Nemi** — calm, short, memorable.
Meanings that fit the product: *tranquil / peaceful* (Japanese 寧) and
*unconquerable* (Bengali, diminutive of Nemanja). Teamwork that feels calm and
wins anyway.

Sound: /ˈnɛmi/ — "NEH-mee".

## Voice

Calm, precise, quietly confident. Nemi talks like a good teammate: no hype,
no exclamation marks fighting for attention. Short sentences. The product does
the shouting.

Tagline candidates:

- **The multiplayer AI IDE.**
- **Your team and its agents, one session.**
- **Work together. Agents included.**

## Palette

Near-black and warm-neutral. One muted brass accent carries identity; state
colours stay desaturated, because on a black page a saturated hue reads as neon.

| Token | Hex | Use |
| --- | --- | --- |
| `--page` | `#08080A` | the page behind everything |
| `--surface` | `#101014` | panels, session cards |
| `--raised` | `#17171C` | raised: inputs, agent bubbles, buttons |
| `--line` | `rgba(255,255,255,.075)` | hairline borders |
| `--text` | `#EDEAE4` | primary text |
| `--muted` | `#8E8B84` | secondary text |
| `--accent` | `#C6A87C` | the one accent: headings, primary actions |
| `--ok` | `#8FA98F` | live, connected, additions |
| `--alert` | `#D4887A` | attention: takeover, errors, removals |

Every colour meant to be read clears WCAG AA on the surface it lands on, and
`scripts/check-ui.mjs` re-derives that from this palette on each `npm run smoke`.
Lane identity colours are assigned from a fixed eight-hue muted palette so every
teammate has a stable hue across sessions; those hold to the same contrast rule,
and no two members share one.

## Mark

`extension/assets/icon.svg` — two overlapping translucent lanes flowing around a
central point: many agents, one session. Original geometry, no resemblance to
any other product's mark.
