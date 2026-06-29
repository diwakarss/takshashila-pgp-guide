# PGP Guide — Product Requirements Document

**Working title:** Takshashila PGP Guide
**Author:** Diwakar (PGP10 cohort, builder)
**Date:** 2026-06-27
**Status:** Draft for build (hand to Conductor / Claude Code)

---

## 1. One-liner

A friendly desktop app that gives every PGP cohort member an AI study companion over the shared course corpus plus their own private learning brain — tutor, quiz, research, and a capstone/assignment workspace — running on the student's own LLM (subscription, API key, or local), fully local and private.

## 2. Problem

The Takshashila PGP is a 48-week, 3-term Post Graduate Programme in Public Policy (6 + 6 + 2 courses, 4 in-person workshops, a capstone policy brief). The cohort is mostly non-technical. Staff actively encourage students to use AI, but the default tools fall short:

- General chatbots (ChatGPT) aren't course-aware and don't cite the actual readings/lectures.
- NotebookLM has no structure for a 48-week, multi-course progression and no active-recall or assignment scaffolding.
- Most students don't know how to use AI well for this specific course, and won't set up tooling themselves.

## 3. Demand evidence

- The builder already contributes to Takshashila's own repos (`takshashila-scholar`, `IndianPublicPolicy`) and used the scholar framework for his admissions essay.
- The admissions interviewer (Sarthak) said "we need more builders like you" and invited an in-person meeting — a live institutional channel.
- Staff already push students toward AI (suggested NotebookLM).
- The builder has a working personal second-brain for the course (gbrain: lessons, extracted readings, ASR'd class transcripts + study notes, knowledge graph) that proves the workflow.

This is **builder mode**: the bar is "ship something genuinely useful to me and at least one cohort-mate, trivially shareable, with Takshashila as a possible amplifier." Not chasing broad PMF. Demand is not the risk; **scope discipline, non-tech onboarding, and the sharing model are.**

## 4. Users

1. **Primary — PGP cohort student (non-technical).** Wants help understanding readings/lectures, testing themselves, researching for assignments, and drafting the capstone, without fighting setup.
2. **Secondary — builder/power user (you).** Wants the full agentic system, own LLM, private notes/positions, capture.
3. **Tertiary — Takshashila.** Potential blesser/host/distributor of the shared corpus; potential adopter for future cohorts.

## 5. Goals / Non-goals

**Goals**
- Zero-to-useful in one short wizard with a single real decision.
- Four distinct, genuinely useful surfaces over one local brain.
- Students bring their own LLM; the builder/Takshashila pay nothing for tokens.
- Course corpus stays current as new lessons/classes are added each week.
- Obey Takshashila's anti-plagiarism / Gen-AI policy by design.

**Non-goals (v1)**
- No hosted backend, no per-user cloud brain, no token billing.
- No multi-user collaboration/real-time sharing of private brains.
- No mobile app.
- Not a general-purpose IDE or agent runner (Conductor is the builder's tool, not the student's).

## 6. Scope (v1 = build all of it; coding cost is low with Claude Code)

- First-launch setup wizard (one decision: choose engine) + welcome slides.
- **5 surfaces** (5 interaction models — not 5 chat boxes):
  - **Tutor** tab (default/home): course navigator (course → LU → lesson) + learning-materials & webinar-summary browsers + cited tutoring, with concept illustrations.
  - **Quiz** tab: active recall, multiple formats (MCQ / true-false / free-form / drag-to-order), graded against source, gamified (XP/streaks/badges), spaced repetition, weak-spot tracking, past-results dashboard.
  - **Research** tab: web + corpus, cited synthesis, conversation history, **highlight → Notebook** (carries the source).
  - **Notebook** tab: titled pages of the student's notes, search, each page with a bibliography of carried sources; the connective tissue between Research and Projects.
  - **Projects** tab: assignment list **pre-loaded from Open Takshashila** (with due dates) + capstone; workspace on the `takshashila-scholar` framework with save/resume; **no-write enforcement** (scaffolds + proofreads, never writes the deliverable); pulls notes + bibliography from the Notebook.
- Concept **illustration system** (ported ian-xiaohei method; pre-generated, shipped in corpus) for Tutor + Quiz.
- Per-tab first-use guided tours; replayable.
- Corpus sync; settings (incl. API token-budget + spend indicator).

## 7. Architecture

### 7.1 Shape
- **Electron desktop app (Windows + macOS).** Required: the brain and (optionally) the LLM run locally; a hosted web page cannot drive a local model, local agent CLI, or local brain. Decision locked: desktop, not web.
- **Local brain = gbrain on PGLite.** Embedded, single-file, no Postgres/Docker/WSL. Ships inside the app. Gives the full knowledge graph, capture, ask, typed edges.
- **Embeddings = bundled Ollama + `nomic-embed-text`** (local, free, offline). Decouples "brain works" from the chosen chat model (important: Anthropic has no embeddings API).
- **Engine = bring-your-own LLM** via an engine-adapter abstraction (see 7.2).

### 7.2 Engine adapters (BYO LLM — student pays, builder pays nothing)
A single `Engine` interface with three adapters, chosen in the wizard:
1. **Subscription via agent CLI** — drive Claude Code and/or Codex as a subprocess (the pattern the builder's widget already uses with `claude -p`). Uses the student's Claude/ChatGPT plan via the CLI's own login. Gentlest "log in" path. (Same mechanism Conductor uses.)
2. **API key** — OpenAI, Anthropic, or any OpenAI-compatible endpoint (OpenRouter, etc.). One adapter covers most.
3. **Local model** — Ollama / LM Studio (OpenAI-compatible local server). Free, private, heavier on the machine.

The app must run regardless of choice; the wizard makes one path the recommended default and the others opt-in.

### 7.2b Embedding (revised): in-process ONNX, no Ollama
Because the corpus ships **pre-embedded** (§7.3), the client only embeds the *student's own*
queries and notes (light, on demand). Run that with an **in-process ONNX `nomic-embed-text`
embedder (e.g. fastembed)** instead of bundling the Ollama service — same vector space, much
smaller install, no background daemon. Pin `nomic-embed-text` everywhere (corpus, queries, notes)
so all vectors are comparable. (Supersedes the earlier "bundle Ollama" decision.)

### 7.3 Corpus: shared course content (pre-embedded bundle + gated endpoint)
- **One PGLite brain, two gbrain sources:** `corpus` (shared, sync-managed) and `private` (the
  student's notes/projects — never touched by sync). Updates can never clobber the student's work.
- **Pre-embedded bundle, built by CI.** A GitHub Action runs `publish-corpus` on a schedule:
  exports the shareable pages from the builder's master brain, computes nomic chunks+vectors+edges
  ONCE, and writes a bundle: per-page records `{slug, frontmatter, markdown, chunks+vectors, edges}`
  + `manifest.json` `{slug → content-hash, version}` + the assignments dataset (§8.5) + the
  illustration assets (§8.9).
- **Delta sync (no client embedding of shared content).** On launch (>24h) or manual Sync, the
  client GETs the manifest, diffs vs local, downloads only changed/new page records, upserts them
  into the `corpus` source (drops removed), rewires edges. First install pulls the full bundle once;
  weekly additions are small deltas, live within 24h, no app update.
- **Gated endpoint = Cloudflare Worker + R2** (free at this scale). R2 stores the bundle; the Worker
  checks a `Bearer` cohort token and serves `GET /manifest.json` + `GET /page/<slug>.json` (or a
  delta tarball). Server-side token = revocable / rotatable / loggable (unlike a baked GitHub token).
  CI uploads the bundle + bumps the version; per-student codes are a later upgrade.

#### 7.3-legacy (superseded note)
The earlier "private GitHub repo + app token" idea is replaced by the gated endpoint above (a baked
repo token is extractable from an Electron app; the Worker token is server-validated and revocable).

### 7.3d Publish pipeline & contents (token mechanism superseded by §7.3)
- **Contents:** curated shareable pages only — course lesson pages, extracted readings, class transcripts + study notes — **plus** the pre-generated illustration assets (§8.9) and the scraped `assignments` dataset (§8.5). Markdown + frontmatter, same shape as the builder's brain content; embeddings precomputed.
- **Publish pipeline (`publish-corpus`, run by CI on a schedule):** exports the shareable subset from the builder's master brain, **computes nomic embeddings/chunks/edges once**, scrapes the Open Takshashila assignment list, bundles it all + a content-hash manifest, and uploads to R2 behind the gated Worker (§7.3). Filters by a `shareable` allow-rule (lesson/section/reading/study-notes/transcript); excludes anything tagged private.
- **Sync (client):** on launch (>24h) + a manual "Sync" button, the app GETs the manifest, diffs vs local, downloads only changed page records, upserts into the `corpus` source (no local embedding of shared content), re-wires `## Related` edges. Offline-first: last synced corpus always works.
- Not world-public — it contains third-party readings + class recordings/transcripts; redistribution stays inside the enrolled cohort (the gated endpoint enforces this; Takshashila-hosted is the target state).

### 7.4 Private layer
- The student's own captures, notes, positions, and saved projects live in the local gbrain as **private** pages (separate source/tag), never uploaded, never shared.

## 8. Feature specs

### 8.1 First-launch wizard (one real decision)
0. **Welcome slides** — a short swipeable intro: what each tab does + the AI-policy ("AI coaches, you write") + privacy, before any setup.
1. **Welcome** — name + one line.
2. **Pick your AI** — three cards: "Use my subscription" (recommended), "Paste an API key", "Run free on my PC". Plain language, jargon glossed. Validates the choice (test call). **Per-choice warnings update with the selected model:** API → "uses your paid credits (set a budget in Settings)"; cloud → "your questions/notes go to [provider]"; weak local model → "answers + quiz grading may be less reliable — pick a cloud model for serious project work".
3. **Auto-setup (no choices)** — starts the local brain (PGLite) + the in-process embedder, downloads the **pre-embedded** course corpus, imports it (no local embedding of shared content → fast even on weak laptops). Single progress bar with friendly status text.
4. **Done → 30-second tour** — lands in Tutor with a sample question pre-filled.

Target: a non-technical student finishes in under ~5 minutes. The hardest step is engine auth; the wizard handles it explicitly (e.g. "install the engine and sign in" if the agent-CLI path is chosen).

### 8.2 Tutor (default tab)
- Conversational study companion over the local brain (corpus + private).
- Three folded behaviors: **Ask** (cited answers, era/staleness aware), **Capture** (save a note/position into the private layer), **Tutor-me** (active-recall coaching that tests, doesn't hand over answers).
- Cited answers: each claim links to source pages (lesson/reading/transcript) as chips.
- Starter chips ("Explain LU-03", "This week's readings", "Quiz me on microeconomics").
- Capture affordance (bookmark) inline.
- Multi-turn threads with history.

### 8.3 Quiz
- Not a chat. Active recall, gamified.
- **On demand, anytime.** Student can ask for a quiz whenever they want (pick a course/week/topic, or "quiz me on this lesson" from Tutor). The app generates questions from the corpus → student answers → graded against the source with citations → tracks weak spots → spaced repetition surfaces weak items over time.
- **Repetition is fine.** Questions may repeat within a course/learning-unit across sessions — not a deal-breaker; repetition reinforces recall. No need to guarantee uniqueness.
- **Formats (mixed per quiz):** multiple-choice, true/false, **free-form** (AI-graded vs source, cited), **drag-to-order** (sequence steps/events). Free-form grading requires a capable model (gate or warn on weak local models, see §8.1).
- **Gamification:** **the more they practice, the more XP / progression** — XP accrues per quiz taken (not only per correct answer), plus streaks, levels/badges, and a **past-results dashboard** (scores, accuracy trend, weak-spot list). Concept illustrations (§8.9) on reveals/rewards. Era-aware (don't quiz superseded content as current).
- **Later (not v1):** an opt-in cohort **leaderboard** (needs a shared backend + identity — defer until there's demand).

### 8.4 Research
- Perplexity-style. Question → fan-out across web + corpus → cited synthesis with numbered sources → follow-up question chips.
- **Conversation history:** threads saved (`type: research-thread`, private source), reopenable to continue.
- **Highlight → Notebook:** select any span of an answer → "Add to Notebook" → the snippet is saved to a chosen/new Notebook page **with its source carried as a bibliography entry** (slug/url + kind). This is the primary capture path.
- "Send findings to a project" action (links into Projects). Cites everything (supports the AI policy).

### 8.4b Notebook (5th surface — connective tissue)
- Titled note pages (`type: notebook-page`, private source) with full-text + source search.
- Each page renders a **bibliography block** of all carried sources (back-links to the corpus page / research thread / web url).
- Inbound: Research highlights + Tutor captures. Outbound: "Use in a project" pulls a page's notes **and its bibliography** into the active Project's evidence.
- Pages are versioned local gbrain pages; editable by the student.

### 8.5 Projects (save/resume) — assignment-driven, no-write enforced
- **Project types:**
  - **Assignment** — picked from the live list **pre-loaded from Open Takshashila** (scraped in the publish pipeline → shipped in the corpus bundle as the `assignments` dataset): title, course, details, **due date** (soon/overdue states).
  - **Capstone** — a single long-running thread (students are already thinking about topics months ahead); persists across the whole programme with full version history.
  - **Personal writing project** — student-created, free topic (a Substack post, an op-ed, anything). Same scholar/coach/proofread surface, but **not a course submission**, so the academic disclaimers + plagiarism checklist don't attach.
- **List view:** cards grouped by type; in-progress cards show % through framework + last edited; "New project" → assignment (pick from list) / capstone / personal. Picking one opens/creates its workspace.
- **No-write guard = ON for all project types** (decided): the tool coaches and proofreads but never writes the deliverable — for assignments, capstone, *and* personal writing. Rationale: it's a *learning* app and the guard builds the student's own writing habit, which is the point even on a Substack post. What's scoped to **course deliverables only** is the academic apparatus — the anti-plagiarism + Gen-AI disclaimers and the pre-export plagiarism checklist (personal projects skip those, since they aren't submissions). **The student's custom system-instructions (§8.7) can never disable the guard.**
- **Editor (split workspace):** left = the scholar framework as guided steps — **Bardach's 8-step policy analysis** (1 Define the problem · 2 Assemble evidence · 3 Construct alternatives · 4 Select criteria · 5 Project outcomes · 6 Confront trade-offs · 7 Decide · 8 Tell your story) with each step carrying Takshashila's **India lenses** (state-capacity check, federal jurisdiction Union/State/Concurrent, "all sectors can fail," "better-or-worse not good-or-bad"); right = the student's draft editor + an **evidence panel** that pulls in Notebook pages (notes + bibliography) and Research findings; AI coaches in the margin (suggest structure, find evidence, stakeholder map (Actor|Position|Interest|Influence), causal-loop check, values review against the four commitments). The 8-step flow produces a **Policy Analysis Memo**, which becomes the basis for the brief + PPT. See §8.8.
- **No-write enforcement (integrity core, see §9):** the assistant brainstorms, guides the scholar steps, retrieves evidence, and **proofreads** (grammar/clarity/structure as *tracked suggestions on the student's own text* — accept/reject), but **never generates the deliverable's prose**. Two layers: (1) system-prompt constraint per surface; (2) a **guard pass** — every Projects generation is classified by a cheap checker for "is this producing substantive deliverable text?" and blocked/redacted if so, with a visible "I can coach and proofread — you write this part" message + a small min-time-lag nudge. Toolbar = *Brainstorm · Find evidence · Stakeholder map · Proofread · Review draft* (no "write it for me").
- **Save/resume:** autosave with a quiet "saved ✓"; resume opens exactly where left off. Each project = a private, versioned local gbrain page (`type: project`), with evidence linked to corpus/Notebook/Research pages. Versioning enables rollback.
- **Export:** brief (+ PPT outline) with anti-plagiarism + Gen-AI disclaimers pre-inserted, a **bibliography assembled from the pulled-in sources**, and a plagiarism-checklist reminder.

### 8.6 Per-tab tours
- First visit to each tab triggers a 2–4 step spotlight walkthrough (what it's for + how it works). Dismissible, "don't show again", and replayable via a "?" / "Show me around" button on every tab.
- Distinct from the global wizard (setup). Per-tab "seen" flags stored locally.

### 8.7 Settings
- Engine (re-run the picker, swap model/key, sign out), corpus sync (status, force sync), brain (location, reset), replay any tour, privacy summary, about/version/update.
- **Profile tab:** the student's display name + a **limited custom-instructions field** (short, capped length) to personalize agent interactions ("explain with Indian examples", "be concise"). Injected into prompts as a soft preamble — **cannot override** safety/policy constraints (no-write guard on course work, citations, disclaimers). Stored locally.
- **Spending (API path only):** student-set monthly budget, a spend indicator (used-this-month + bar), per-session estimates before expensive actions, and a pause-at-budget guard. Hidden for subscription/local.
- **Usage metrics toggle:** anonymous usage metrics are **on by default** (disclosed at first run + in this panel); a clear off switch (§11). Plus a **Submit feedback** button (opens a short form / mailto, includes app version; no personal content unless the student types it).

### 8.8 Scholar framework — LLM-agnostic port (hard requirement)

`takshashila-scholar` (github.com/pranaykotas/takshashila-scholar) is a **Claude Code plugin** (commands + subagents + SKILL.md files + MCP wiring for Zotero/Obsidian, "Claude Code only"). PGP Guide is **bring-your-own-LLM**, so it must **not** depend on Claude Code's skill/subagent runtime or those MCP servers. We **carry over the principles and workflow**, re-implemented model-agnostically.

**Port these (the substance — keep verbatim where it's methodology):**
- **Bardach's 8-step analysis** as the Projects workflow (see §8.5).
- **India lenses**, applied at the relevant steps: state-capacity check (spending vs capability vs ambition), federal jurisdiction (Union/State/Concurrent List), "all sectors can fail" (don't default to pure-market or pure-government), "better-or-worse, not good-or-bad" (comparative, not moral), and Indian policy vocabulary (Union Budget, PLI, DPIIT…).
- **Four intellectual commitments** (the values-review lens): freedom, pluralism, citizenship, realism in IR.
- **Analytical moves:** stakeholder matrix (Actor|Position|Interest|Influence), problem disaggregation (market failure type / coordination / political economy / capacity), gap analysis, feasibility/implementation-capacity assessment, causal-loop analysis.
- **Draft review** = argument critique (what a hostile peer reviewer would raise) + values review + causal analysis.
- **"Anti-AI writing" pass** = help the student's *own voice*, not ghostwriting (aligns exactly with the AI policy, §9).
- **Artifacts:** policy analysis memo, policy brief, op-ed, discussion document, presentation, poster, rebuttal, literature synthesis.
- **The ethos, stated verbatim in the scholar README:** *"It is not a shortcut. It is a scaffold."* This is PGP Guide's north star for Projects.

**Re-map the Claude-Code/MCP bits to PGP Guide surfaces:**
- Scholar `commands` (policy-analysis, policy-brief, draft-review, op-ed…) → **Projects** flows + a "Review my draft" coach action.
- Scholar `agents` (policy-analyst, rebuttal-writer, government-source-finder, literature-reviewer) → **roles** the workflow invokes as sub-prompts (not Claude subagents).
- Zotero (references) → PGP Guide's own sources/corpus; Obsidian (notes) → the local gbrain; Parliament/government-source-finder → the **Research** tab (web + corpus); Google Docs export → PGP Guide export.

**Implementation:**
- A **Scholar Engine** in PGP Guide = portable **prompt templates** (plain model-neutral text extracted from the scholar command/agent/SKILL markdown) + a **workflow runner** that executes multi-step flows by calling whichever engine adapter the user picked (§7.2). No Claude-specific tool calls in the templates; any needed tools (web search, corpus lookup) go through PGP Guide's own functions.
- **Stay in sync with upstream.** The scholar repo is Takshashila's and evolves. Build a **convert step** that ingests the scholar repo's command/agent/SKILL markdown and regenerates PGP Guide's templates, so upstream updates carry over. This also makes PGP Guide a faithful multi-LLM front-end to Takshashila's own framework (a strong point for the Sarthak conversation).

### 8.9 Illustration system (ported ian-xiaohei method)
- **Goal:** anchor abstract concepts (a judgment, process, trade-off, metaphor) with one memorable hand-drawn image in Tutor + Quiz. Adapted from the `ian-xiaohei` Codex skill — port the *method* (white-bg hand-drawn line, a recurring "analyst" character that participates in the concept, minimal English annotations in our palette, 16:9), not its Chinese-text runtime. Same LLM-agnostic porting approach as the scholar framework (§8.8).
- **Built on the builder side, shipped in the corpus.** A `generate-illustrations` step keys illustrations to course concepts/learning-units and produces them once (using an image model on the builder's machine), then bundles the assets into the corpus (§7.3d). The app references them by concept key.
- **No per-student image-gen dependency** — works regardless of the student's chosen LLM (most BYO text models can't do images). Used with intent (concept anchoring, quiz stems, streak rewards), never as decoration; kept off dense-text surfaces.

## 9. AI-policy compliance (hard requirement)

Takshashila policy: AI may be used for research leads, synthesis, editing, and visualizing, but the final submission must be the student's own words; strict zero-plagiarism with real consequences.

Design implications:
- **Projects scaffolds, never ghostwrites — enforced, not requested (see §8.5).** Allowed: Socratic brainstorming, scholar-step guidance, evidence retrieval, and proofreading (tracked suggestions on the student's *own* text). Forbidden: generating the deliverable's prose. Enforced by a system-prompt constraint **plus a guard pass** that classifies and blocks substantive ghostwriting. No "write my essay" button anywhere in the UI.
- **The boundary, precisely (validate with Takshashila):** the AI may ask questions, list/locate evidence, map stakeholders, critique an argument, and fix grammar/clarity/structure of text the student wrote — it may **not** author new sentences/paragraphs of the student's analysis or conclusions. Proofreading edits are shown as suggestions, never silent rewrites.
- **Everything is cited.** Tutor and Research always show sources; Notebook carries them; Projects assembles the bibliography from them — encouraging original synthesis over copy-paste.
- **Disclaimers auto-added** to project exports (the exact anti-plagiarism + Gen-AI disclaimer text from the course policy).
- **Plagiarism nudge:** a reminder/checklist before export (run through a plagiarism checker, confirm own words).

## 10. UX principles (non-technical audience)

One primary action per screen; plain language (never show "API / embeddings / MCP / gbrain"); a progress bar for every wait; friendly empty/loading/error states; guided wizards and tours; calm scholarly visual language. See `DESIGN.md`.

## 11. Privacy & security

- Local-first: brain and notes never leave the machine. Corpus pull is read-only.
- BYO credentials: API keys / tokens stored in the OS secure store (Keychain / Credential Manager), never in plaintext config, never transmitted anywhere except the chosen provider.
- Corpus access token is read-only and scoped; treat as low-sensitivity but don't expose in logs.
- **Anonymous usage metrics: ON by default, opt-out in Settings.** Goal is only to know whether the app is being used and roughly how (tab opens, quizzes taken, projects created, sync success, crashes) — **never content** (no questions, notes, drafts, names, sources). Disclosed plainly at first run ("anonymous usage metrics are on — turn off any time in Settings") and toggleable in Settings (§8.7). A random install-id, not a person. Lightweight endpoint (the same Worker, a `/metrics` route, or a hosted analytics sink). **Submit-feedback** is separate and explicit (student-initiated).

## 12. Distribution & updates

- **App:** installers for Windows + macOS via GitHub Releases; in-app update check ("a new version is available"). v1 ships **unsigned** (small known cohort — §13a); the wizard/README explains the one-time "unknown developer" prompt. Add code signing if distribution widens.
- **Corpus:** updates flow through sync (7.3), independent of app releases — new lessons/classes reach students within 24h (or on manual Sync) without an app update.

## 13. Risks, mitigations & open questions (pre-mortem)

### 13a. Decided (closed by the builder)
- **Subscription-via-CLI: accepted.** Same model as Conductor — each student uses *their own* account on *their own* machine; the app just drives the CLI they installed. Not treated as a ToS blocker.
- **Corpus delivery: resolved.** Ship the corpus **pre-embedded** (no client embedding of shared content → no first-run freeze) behind a **gated Cloudflare Worker + R2** with a server-validated, revocable token (not a baked GitHub token). See §7.3 / §7.3d.
- **Embedding: in-process ONNX (no Ollama).** Since the corpus is pre-embedded, the client only embeds queries + the student's own notes — run in-process (fastembed nomic), dropping the Ollama bundle. See §7.2b. (Removes most of the install-burden risk.)
- **Code signing: skipped for v1.** Unsigned is acceptable for a small known cohort; revisit if distribution widens (then budget Apple Developer $99/yr + a Windows cert).
- **Recording/redistribution: acceptable.** Shared with the same people who attended the classes, via Takshashila's own platform that already hosts recordings/materials. Takshashila ownership remains the clean target.

### 13b. Still to design well (carried into the specs)
- **gbrain-on-PGLite + vector** must ship cleanly in an Electron bundle — largely de-risked (the personal brain ran on PGLite + nomic before moving to Postgres only for the multi-client daemon), but spike it on a clean machine in Phase 0.
- **The "scaffold not ghostwrite" line** — addressed by the no-write guard + precise boundary (§8.5/§9); still validate the exact line with Takshashila.
- **Quality varies by chosen LLM** — addressed by per-model warnings (§8.1) + gating free-form grading/critique on a capable model (§8.3); set a recommended minimum.
- **API cost** — addressed by the budget + spend indicator + pre-action estimates (§8.7).
- **Cloud LLM ≠ private** — stated plainly in the wizard (§8.1).

### 13c. Operational / sustainability
- **You become support for ~30 non-tech users while doing a 48-week degree.** Build for it: plain-language errors, one-click reset, a "send diagnostic" button, an FAQ/Discord. Otherwise support buries you.
- **Multi-dependency fragility.** gbrain, Ollama, Claude Code/Codex, provider APIs, the corpus repo — any can change and brick the app for everyone. Version-pin everything; test before pushing app or corpus updates.
- **Bus factor / longevity.** If it becomes the cohort's tool, Takshashila ownership matters for it outliving your enrolment.

### 13d. Still open
- Account/identity (none in v1 — local only; needed later only for the leaderboard); offline behavior (works on last-synced corpus — confirm); naming/branding (pending Takshashila). (Usage metrics decided: anonymous, on-by-default, opt-out — §11.)

## 14. Build sequence (phased; each phase shippable)

**Phase 0 — de-risk spikes (do FIRST; build no UI until all green).** (a) gbrain/PGLite + vector search running in a clean Electron bundle on a clean Windows machine; (b) in-process ONNX nomic embedder producing vectors that match the pre-embedded corpus; (c) pre-embedded corpus pull (gated Worker + R2) → import → query, no local embedding of shared content; (d) one engine adapter working end-to-end. A failed spike changes the design — better to learn it here than after five tabs exist.

**Narrowed v1:** ship **spine + Tutor only** to a couple of real students on their real machines before building Quiz/Research/Notebook/Projects. Prove install + onboarding + one surface survive contact with non-tech users first.

1. **Shell + brain + wizard + corpus sync.** Electron app, local gbrain/PGLite (corpus + private sources), in-process embedder, engine wizard (one adapter + welcome slides + per-model warnings), pre-embedded corpus pull + import. Proves the spine.
2. **Tutor.** Course navigator + materials/webinar browsers + cited answers + capture + illustrations + tour.
3. **Quiz.** Multi-format generation + grading + gamification/dashboard + spaced rep + weak spots + tour.
4. **Research + Notebook.** Fan-out + sources + conversation history + highlight→Notebook + Notebook pages/bibliography/search + tour. (Built together — they're one flow.)
5. **Projects.** Assignment list (pre-loaded) + editor + scholar framework + evidence pull from Notebook + **no-write guard** + save/resume/autosave + export with bibliography + tour.
6. **Illustrations + polish + package.** `generate-illustrations` pipeline, per-tab tours, settings (incl. spend), update check, clean-machine install test (Win + Mac).
7. **Publish pipeline + Takshashila handoff.** `publish-corpus` (export + embed + scrape assignments + bundle) on CI, the gated endpoint, the Sarthak conversation.

## 15. Success metrics (builder-mode bar)

- It works end-to-end for the builder on the real corpus.
- At least one non-technical cohort-mate installs it, finishes the wizard unaided, and uses it in a real study session (watch them do it).
- Weekly corpus sync keeps content current with no manual student effort.
- Zero AI-policy violations designed-in (no ghostwriting path exists).

---

*Companion: `DESIGN.md` (UI design system + screen specs). Reference mockup produced in the office-hours session (app shell + four tabs + wizard).*

---

## 16. Engineering Review — Locked Decisions (2026-06-29)

Outcome of `/plan-eng-review`. Each decision was made interactively; these are binding for the build.

### Architecture
- **D1 — Engine adapters:** ship all three in v1 (subscription/agent-CLI, API key, local). Full BYO-LLM vision.
- **D2 — No-write guard:** two layers, **engine-independent**. A deterministic layer (draft-vs-output diff, net-new-prose heuristics) runs regardless of engine, plus the LLM classifier, plus a **capability gate** that hard-blocks free-form generation on engines below a known bar. The integrity promise must not depend on the weakest model a student can pick.
- **D3 — Sync never clobbers private:** enforce, don't assert. Source-scoped **write-fence** (sync writes can't address private rows) + transactional sync that aborts on any private-row touch + a **pre-sync private snapshot** for rollback + a mandatory **destructive test**.
- **D4 — Agent-CLI path:** stays the recommended wizard default (builder's call), but **hardened**: pinned/tested CLI versions + drift detection + startup health-check + plain-language fallback to the API-key path when broken/absent.
- **D5 — Embedding parity:** pin the nomic **prefix convention** as a contract (`search_document:` corpus / `search_query:` queries) + pinned pooling/normalization + a **vector-parity test** and a **retrieval-smoke test** in Phase 0(b). (nomic degrades 5–10 MTEB silently on prefix mismatch.)

### Code quality
- **D6 — EngineCapabilities:** one descriptor per adapter (`quality_tier, supports_images, supports_streaming, context_window, cost_per_token, can_grade_freeform, passes_nowrite_gate`) is the single source of truth; wizard, quiz, projects, illustrations, and spend all read from it. Kills 5-way duplication.
- **D7 — Scholar port:** **manual** one-time port for v1; auto-converter deferred to `TODOS.md`.

### Tests
- **D8 — Test strategy:** full pyramid committed in the plan — Vitest unit + integration (brain/sync/credential-store in packaged context) + Playwright-for-Electron E2E (wizard, Tutor) + an **eval harness** for `[→EVAL]` paths. CI runs unit+integration on every push and gates merge; E2E + evals run pre-release. Tests written alongside each codepath, per phase.
- **D9 — Integrity gate:** the no-write **adversarial eval is a hard release gate** for Projects — a curated corpus (direct asks, role-play framing, "fix this" rewrites, multilingual, incremental-paragraph attacks) must be **100% blocked across every engine tier**, re-run in CI on any guard/adapter change. Corpus curated with a real cohort-mate's phrasing.

### Performance
- **D10 — Phase 0 budgets:** spikes get **numeric pass/fail** on a deliberately weak reference machine (first-import time, Tutor query end-to-end ≤ ~2–3s, warm query-embed ≤ ~300ms) + **embedder warm-up** during auto-setup + an HNSW-vs-IVFFlat choice driven by measured build-vs-query tradeoff.
- **D11 — Install weight:** first-install **size budget**; text + vectors download first (app usable fast), **illustrations lazy-load** by concept key and cache, kept off the delta-sync hot path.

### Outside voice (Codex) — builder decisions
- **OV-1 (legality/governance, Codex #1/#6):** **noted as risk, keep building.** Not treated as a v1 blocker (see Failure Modes). Corpus legality + publish-governance carried as known risks.
- **OV-2 (MVP validates thesis, Codex #4):** **build order unchanged.** The builder is cohort user-zero and dogfoods every phase on the real corpus before anyone else installs, so spine→Tutor→…→Projects sequencing self-validates the connective flow.
- **OV-3 (telemetry/trust, Codex #2/#7):** **telemetry OFF by default + explicit onboarding opt-in;** correct the "fully local and private" one-liner to honest local-first wording.

### Residual risks the builder accepted (not mitigated in v1)
- **Code signing skipped** (TODO-1 declined) — unsigned installers; "unknown developer" prompts are accepted friction for the small known cohort.
- **Assignment scrape has no fallback** (TODO-2 declined) — a markup change or staff objection breaks the Projects assignment list with **no manual-import fallback and a silent-failure path**. Flagged as the one critical gap below.
- **Corpus legality** (OV-1) — embedding/transcribing/redistributing third-party readings + recordings via R2 proceeds on the "cohort already has access" assumption without written Takshashila sign-off.

## 17. What already exists (reuse posture)

- **Builder's gbrain** (lessons, extracted readings, ASR'd transcripts + study notes, knowledge graph) — the master content source the publish pipeline exports from. Reused, not rebuilt.
- **`takshashila-scholar`** (Bardach 8-step + India lenses + four commitments) — ported model-neutrally (D7), not reinvented.
- **`ian-xiaohei`** illustration method — method ported, not its Chinese-text runtime.
- **Open Takshashila** assignment list — scraped into the corpus bundle (no fallback yet, see residual risk).
- **PGLite + pgvector** (`@electric-sql/pglite-pgvector`, pgvector 0.8) — confirmed viable in Electron; storage bet is sound, not custom-built.
- **`claude -p` subprocess pattern** — the builder's existing widget already drives an agent CLI; the subscription adapter reuses that mechanism.

## 18. NOT in scope (v1)

- Cohort leaderboard (needs shared backend + identity) — PRD §8.3, deferred.
- Per-student corpus tokens (cohort-wide token for v1) — PRD §7.3, later upgrade.
- Scholar auto-converter — `TODOS.md`, manual port for v1.
- Code signing — declined for v1 (residual risk).
- Assignment-scrape manual-import fallback — declined for v1 (residual risk).
- Hosted backend / per-user cloud brain / token billing / mobile / multi-user — PRD §5 non-goals.

## 19. Failure modes (per new codepath)

| Codepath | Realistic failure | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| Sync vs private data | Sync clobbers the capstone | ✅ destructive test (T2) | ✅ write-fence + snapshot rollback | n/a — prevented |
| No-write guard | Ghostwrite slips past on weak engine | ✅ adversarial gate (T3) | ✅ deterministic layer + capability gate | "I can coach and proofread — you write this part" |
| Embedding | Prefix mismatch → worse retrieval | ✅ parity + smoke (T4) | ✅ pinned contract | n/a — prevented |
| Agent-CLI path | Upstream CLI bump bricks the path | ⚠️ integration (T6) | ✅ health-check + API-key fallback | plain-language fallback prompt |
| **Assignment scrape** | **Markup change / staff objection** | **❌ none** | **❌ no fallback (declined)** | **❌ silent — stale/empty list** |
| First install | Bundle too big on slow bandwidth | ⚠️ — | ✅ text+vectors first, lazy images | progress bar, usable early |
| Corpus legality | Takedown / publisher objection | ❌ external | ❌ process risk (declined) | n/a — external |

**Critical gap (1):** Assignment scrape failure is the only path that is untested, unhandled, AND silent — accepted by the builder (TODO-2 declined). Revisit before Projects ships to real users.

## 20. Worktree parallelization strategy

| Lane | Modules | Depends on |
|---|---|---|
| A — Brain & sync | `brain/`, `sync/` | — |
| B — Engine layer | `engine/` (3 adapters, EngineCapabilities, CLI hardening) | — |
| C — Embedder & parity | `embedder/`, `scripts/publish-corpus/` | — |
| D — Test infra & CI | `.github/workflows/`, `test/`, `evals/` | — (cross-cutting, start immediately) |

**Execution:** Launch A + B + C + D in parallel worktrees during Phase 0 — they touch disjoint modules. All four converge at the wizard/auto-setup integration point, which is the barrier before any UI work. **Conflict flag:** the no-write guard (T1) and the integrity eval (T3) both touch `guard/` — keep them in one lane (sequential) to avoid merge conflicts. Phase 0 spikes must all be green before Tutor UI begins.

## 21. Implementation Tasks
Synthesized from this review. P1 blocks ship; P2 same-branch; P3 follow-up.

- [ ] **T1 (P1, human: ~2d / CC: ~30min)** — no-write-guard — Two-layer guard: deterministic diff/heuristic + classifier + capability gate (D2)
- [ ] **T2 (P1, human: ~2d / CC: ~30min)** — brain-sync — Write-fence + transactional sync + pre-sync private snapshot + destructive test (D3)
- [ ] **T3 (P1, human: ~1d / CC: ~20min)** — integrity-eval — No-write adversarial corpus + hard release gate, 100% across engine tiers (D9)
- [ ] **T4 (P1, human: ~1d / CC: ~20min)** — embedder — Pin prefix/pooling/normalization contract + vector-parity + retrieval-smoke test (D5)
- [ ] **T5 (P2, human: ~4h / CC: ~15min)** — engine — Single EngineCapabilities descriptor, read everywhere (D6)
- [ ] **T6 (P2, human: ~1d / CC: ~20min)** — engine — Agent-CLI hardening: version pin + drift detect + health-check + API-key fallback (D4)
- [ ] **T7 (P1, human: ~2d / CC: ~30min)** — test-infra — Vitest + integration + Playwright-Electron + eval harness, CI-gated per phase (D8)
- [ ] **T8 (P2, human: ~1d / CC: ~20min)** — perf — Phase 0 numeric budgets + embedder warm-up + HNSW/IVFFlat choice (D10)
- [ ] **T9 (P2, human: ~4h / CC: ~15min)** — corpus — Lazy-load illustrations + first-install size budget (D11)
- [ ] **T10 (P2, human: ~3h / CC: ~10min)** — privacy — Telemetry off-by-default opt-in + honest one-liner wording (OV-3)
- [ ] **T11 (P3, human: ~15min / CC: ~3min)** — docs — Fix 4-vs-5 surface contradiction (PRD §4/§6 + DESIGN) (Codex #5)
- [ ] **T12 (P2, human: ~1d / CC: ~20min)** — design — Reconcile Tutor + Projects density with one-primary-action; run /plan-design-review (TODO-3)
- [ ] **T13 (P3, human: ~1d / CC: ~30min)** — scholar — Manual port of scholar prompts to model-neutral templates (D7)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 10 missed-problem findings, 3 actioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 10 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | recommended (T12) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** outside voice surfaced legality/governance, telemetry-trust, MVP-thesis, and a 4-vs-5 scope doc bug; 3 actioned (legality→risk, build-order kept, telemetry→opt-in), rest routed to tasks/TODOs.
- **CROSS-MODEL:** no contradictions; Codex independently agreed the agent-CLI default is high-friction for non-tech users (builder kept it, hardened via D4).
- **UNRESOLVED:** 0 decisions left open.
- **VERDICT:** ENG review complete — 10 issues resolved into binding decisions + 13 implementation tasks. 1 accepted critical gap (assignment-scrape silent failure) and corpus legality carried as builder-accepted risks. Design review (T12) recommended before building Tutor/Projects.

