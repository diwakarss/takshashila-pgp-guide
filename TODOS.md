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

## Ship the illustration library with the corpus (publish pipeline)

**✅ DONE (2026-07-03).** `studyBrain.publishLibrary()` exports the library into an
`illustrations/` bundle (images + `concepts.json` incl. embeddings) beside the corpus
markdown, so it travels with the corpus repo. `importLibrary()` loads it into a student's
brain (upsert with shipped embeddings, no re-embedding) + copies images locally, and runs
automatically at the end of `importCorpus`. Verified round-trip: wipe → reload 28
concepts/28 images → reuse works. Builder runs `PGP_DEV_PUBLISH_LIBRARY=1`, then commits the
bundle to the corpus (pgp-brain) repo. Remaining for later: the Worker/R2 auto-sync of the
bundle (§7.3d) — for now it ships via the git corpus repo.

---
_Original context:_

**What:** Bundle the concept illustration library with the corpus so students get
illustrations for free. Two parts that must travel together:
1. The image PNGs (currently only in the builder's `userData/illustrations/`).
2. The `concepts` table rows — key, title, course, **embedding**, image_file — so a
   student's app can embedding-match a slide to a library image.

**Why:** Right now the library lives only on the builder's machine. A student install
has an empty `concepts` table → every slide illustration is a miss → blank. "Deliver
with pre-built images" doesn't work until this ships.

**Where to start:** the `publish-corpus` pipeline (PRD §7.3d) — export concepts + images
into the corpus bundle; on import, load them into the student's brain + illustrations dir.

**Depends on:** the corpus publish pipeline existing.

## Hard-off illustration generation in production (student builds)

**✅ DONE (2026-07-03).** `studyBrain.imageGenEnabled()` gates generation: OFF in packaged
builds by default, ON in dev, with `PGP_ENABLE_IMAGE_GEN=1` / `PGP_DISABLE_IMAGE_GEN=1`
overrides. `resolveIllustration` checks it BEFORE the `imageEngine.isAvailable()` branch, so
a library miss in a student build returns "not in the illustration library" and never
generates — even with a stray key. `illustrationAvailable` IPC now also reflects it.
Verified with `PGP_DISABLE_IMAGE_GEN=1`: unknown concept → no generation.

---
_Original context:_

**What:** An explicit "generation disabled" flag for shipped/student builds, so a slide
illustration miss NEVER triggers image generation — regardless of any stray OpenAI key
on the student's machine.

**Why:** Today generation is only gated by `imageEngine.isAvailable()` (= "is an OpenAI
key present?"). Students lack a key so it's safe *in practice*, but it's an implicit guard.
An explicit production flag makes "students never generate, never get charged" a guarantee,
not an accident of key-absence.

**Where to start:** `studyBrain.resolveIllustration` — add a build/config flag checked
before the `imageEngine.isAvailable()` branch; library-match still works, generation is
off. Builder/dev keeps generation on.



## Verify Windows path end-to-end (before cohort distribution)

**What:** The three-path AI setup is now written cross-platform (PATH delimiter +
.exe/.cmd resolution, cmd.exe shim spawning, PowerShell terminal handoffs,
platform-correct installers: claude install.ps1 / npm codex / Ollama .exe
download, LOCALAPPDATA detection) — but it has only ever RUN on macOS.

**Why:** The cohort will include Windows laptops; a dead Install button or a
mis-spawned .cmd shim would be a first-run dead end.

**Where to start:** On a real Windows machine: fresh-machine wizard
(PGP_DEV_FAKE_MISSING), install handoffs for all three paths, claude/codex
detection + sign-in, one tutor ask per engine, Ollama pull + smoke.

## Corpus distribution for students (delivery infra decision)

**What:** "Get latest classes" syncs by `git pull` of the corpus clone — which
works for JD (repo access) but students won't have credentials for the private
pgp-brain repo. Decide + build the student-facing channel: Cloudflare Worker/R2
mirror (gated), a GitHub deploy token baked into builds, or a public release
bundle per week.

**Why:** Weekly ingest (pgp-brain tools/ingest) now lands new classes in the
repo automatically; the last mile to cohort machines is the only missing hop.
The app side is ready: syncCorpus() falls back to import-only when the corpus
dir isn't a git clone, so any mechanism that refreshes that folder works.

**Where to start:** `studyBrain.syncCorpus()` (the pull step) and the
corpusDir() comment — swap the pull for a fetch-from-mirror; scripts/sync-test.sh
is the acceptance test to adapt.

## Replace noisy live-capture webinars 1–2 with recording-based versions

**What:** Clean recording-based transcripts + notes for "Introduction to
Economic Reasoning" (staged in ~/.pgp-ingest/staging/, 13 files) vs the old
widget capture (microeconomics-1-20260620*, missing first ~8 min, desktop OCR
noise in slide blocks). Same question for market-dynamics vs
microeconomics-i-class-2. Needs JD's call: replace (delete old slugs) or keep both.
