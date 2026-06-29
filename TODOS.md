# TODOS

Deferred work captured during the engineering review (2026-06-29). Each item has
enough context to pick up cold.

## Scholar auto-converter (deferred from v1 — D7)

**What:** A `convert` step that ingests the upstream `takshashila-scholar` repo's
command/agent/SKILL markdown and regenerates PGP Guide's model-neutral prompt
templates automatically.

**Why:** Lets upstream scholar updates flow through without a manual re-port, and
keeps PGP Guide a faithful multi-LLM front-end to Takshashila's live framework (a
selling point for the Sarthak conversation).

**Why deferred:** Writing a parser/codegen against someone else's evolving markdown
format is premature now. v1 does a one-time **manual** port (hand-tuned, model-neutral,
higher quality). See PRD §8.8.

**Trigger to build:** when the scholar repo starts changing more than ~once a term, or
when a manual re-port becomes painful.

**Where to start:** the manual v1 templates become the golden output the converter must
reproduce; diff converter output against them as the acceptance test.

**Depends on:** v1 Scholar Engine (templates + workflow runner) existing first.

## Dark-mode variants + contrast audit (deferred from design review — D9)

**What:** Produce a dark-mode variant of every surface and run a WCAG-AA contrast
check on each, against the inverted tokens in DESIGN.md §3.1 (ink bg `#161A22`,
surfaces `#1F2530`, text `#EDEFF3`, brand/accent legibility on dark).

**Why:** Dark mode is a stated requirement (§3.1) but no screen has a dark variant
and contrast is unverified. Shipping it unchecked risks unreadable text or failing
accessibility on half the app.

**Why deferred:** The palette is provisional pending Takshashila brand; building dark
specs now is partly throwaway. Do it once the light palette is locked.

**Where to start:** invert each of the six approved mockups, check brand `#1B3A6B`
and the per-tab accents stay legible on dark, audit body text contrast ≥ 4.5:1.

**Depends on:** light palette finalized (ties to the brand-alignment TODO below).

## Takshashila brand / wordmark / palette alignment (deferred — D10)

**What:** Replace the provisional scholarly palette + "PGP Guide" working wordmark
with official Takshashila brand assets once available (DESIGN.md §9).

**Why:** The current palette and name are placeholders; the real brand is part of the
Sarthak/Takshashila conversation and the app should match it before wider distribution.

**Trigger to build:** when Takshashila brand assets (logo, colors, type) arrive.

**Where to start:** swap the color tokens in DESIGN.md §3.1, update the wordmark in the
shell, then re-run the dark-mode + contrast audit above against the real palette.

