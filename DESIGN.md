# PGP Guide — UI Design System & Screen Specs (DESIGN.md)

**Date:** 2026-06-27
**Scope:** Electron desktop app (Windows + macOS), **5 tabs** (Tutor, Quiz, Research, Notebook, Projects) + wizard.
**Audience:** mostly non-technical postgraduate students.
**Companion:** `PRD.md`. A clickable reference mockup (app shell + tabs + wizard) was produced in the office-hours session — match its structure (now extended with Notebook + richer per-tab surfaces).

**North star:** this is a *purpose-built course companion*, not a chatbot with tabs. The thing a generic chatbot can't do is the **connective flow** — Research → highlight → Notebook (carries the bibliography) → Projects (pulls notes + citations into the draft). Design every surface to feed that flow.

---

## 1. Design principles

1. **One primary action per screen.** The student should always know the next thing to do.
2. **Plain language only.** Never surface "API", "embeddings", "MCP", "gbrain", "PGLite", "Ollama", "tokens". Say "your AI", "your study brain", "the course library".
3. **Every wait shows progress.** No spinners without context; use a labeled progress bar ("Downloading this week's classes…").
4. **Guided, not discovered.** A one-time setup wizard + per-tab first-use tours + a persistent "Show me around" button.
5. **Calm and scholarly.** This is a place to study. Generous whitespace, restrained color, readable type. No hype, no neon.
6. **Trust through visibility.** Always show: which AI is connected, sync status, and that work is saved.
7. **Five tabs, five interaction models.** Guided study surface (Tutor), graded cards (Quiz), search+sources (Research), notebook of pages (Notebook), document workspace (Projects). Do not collapse them into five chat boxes — only Research is conversational.
8. **The AI-policy guardrail is part of the UI**, not a footnote: "AI scaffolds, you write." In Projects it is *enforced*, not just stated (no-write guard, §5.6).
9. **Illustrations teach.** Hand-drawn concept illustrations (ported ian-xiaohei method, §3.6) appear in Tutor and Quiz to anchor abstract ideas — used with intent, never decoration.

## 2. Brand & voice

- **Tone:** a calm, encouraging tutor. Warm, never childish. Confident, never salesy.
- **Microcopy:** short sentences, active voice, second person ("Ask anything about the course"). Sentence case everywhere, never Title Case or ALL CAPS.
- **Name:** "Takshashila PGP Guide" (working). Align logo/wordmark with Takshashila brand once confirmed.

## 3. Visual language

### 3.1 Color
Propose a scholarly palette; replace with official Takshashila brand colors once available.

- **Ink (primary text):** `#1C2433` (near-navy charcoal)
- **Parchment (app background):** `#FAF8F3` (warm off-white)
- **Surface (cards, panels):** `#FFFFFF`
- **Primary / brand (Takshashila navy):** `#1B3A6B`
- **Accent (calls to action, active):** `#C6562E` (warm terracotta — sparingly)
- **Muted text:** `#5C6675`
- **Hairline border:** `rgba(28,36,51,0.12)`
- **Per-tab accent (subtle, for icons/active state only):** Tutor `#1B6FB3` (blue), Quiz `#1D8A66` (teal), Research `#B5781A` (amber), Projects `#5A4AB0` (purple).
- **Semantic:** success `#1D8A66`, warning `#B5781A`, danger `#B23A38`, info `#1B6FB3`.
- **Dark mode:** required. Invert to ink background `#161A22`, surfaces `#1F2530`, parchment-equivalent `#12151C`, text `#EDEFF3`. Keep brand/accent legible on dark.

Rule: max two color families per screen besides neutrals. Color encodes meaning (tab identity, semantic state), not decoration.

### 3.2 Typography
- **UI font:** Inter (or system: Segoe UI / SF Pro). 
- **Reading font (long transcripts, study notes, briefs):** a readable serif (e.g. Source Serif / Georgia) for body content panes only; UI chrome stays sans.
- **Scale:** H1 22 / H2 18 / H3 16 (all weight 500); body 15–16 weight 400, line-height 1.6–1.7; small/meta 12–13.
- **Two weights only:** 400 and 500. No 600/700.
- Never below 12px.

### 3.3 Spacing & shape
- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32.
- Radius: 8 (controls), 12 (cards/panels), pills only for chips/badges.
- Borders: 1px hairline; emphasis 1px secondary. No drop shadows except functional focus rings.
- Flat surfaces. No gradients, glow, or texture.

### 3.4 Components
- **Buttons:** primary (brand fill, white text), secondary (outline), ghost (text). One primary per screen.
- **Cards:** white surface, hairline border, radius 12, padding 16–20.
- **Chips:** pill, hairline border, used for starter prompts, follow-ups, tags, sources.
- **Source chip:** icon + short title + source kind; click opens the source page.
- **Inputs:** 36–40px height, clear focus ring; textareas auto-grow.
- **Progress bar:** 4–5px track, brand fill, with a status label above.
- **Status pill (sidebar):** engine ("Claude · your plan"), sync ("Synced 2h ago"), with icons.
- **Coachmark/tour bubble:** small card with step dots, "Next"/"Got it", and "Don't show again".
- **Empty states:** friendly illustration or large icon + one line + one primary action.

### 3.5 Iconography
- One outline icon set (e.g. Tabler/Lucide), 18–20px in nav, 16px inline. Per-tab: book-open (Tutor), checkbox (Quiz), search (Research), notebook (Notebook), file-text (Projects).

### 3.6 Illustration system (ported ian-xiaohei method)
- **What it is:** a small set of hand-drawn, white-background concept illustrations that turn one abstract idea (a judgment, a process, a trade-off, a metaphor) into a memorable image — adapted from the `ian-xiaohei` Codex skill (port the *method*, not its Chinese-text runtime; English annotations, our palette).
- **Style:** white background, loose hand-drawn line, a single recurring character ("the analyst") that participates in the concept, minimal annotations in brand ink + one accent. 16:9. Calm, not cartoonish — fits "calm and scholarly."
- **Where:** Tutor (an illustration beside a concept explanation), Quiz (as the stem of a "what does this show?" item, or a reward on a streak). Never on dense-text screens (Research/Projects/Notebook stay text-clean).
- **How shipped:** illustrations are **pre-generated on the builder side**, keyed to course concepts/learning-units, and travel inside the corpus bundle (PRD §7.3). The app references them by concept key — **no per-student image-generation dependency**, so it works regardless of the student's chosen LLM.

## 4. App shell

- **Window chrome:** native title bar; app name in header. A persistent header strip may carry the current term/week and a global Sync button.
- **Left sidebar (~160px):** wordmark; five nav items (Tutor, Quiz, Research, Notebook, Projects) with icon + label and an active state (surface fill + tab-accent left marker); bottom block: engine status, sync status, Settings.
- **Content area:** one tab at a time. Each tab owns its own layout (below).
- **Responsive:** min window ~960×640. Sidebar collapses to icons under ~820px. Content reflows; no nested scrollbars; the active content pane scrolls.

## 5. Screen specs

### 5.1 First-launch wizard
- Centered, single-column, max ~560px, on parchment. Step indicator "Step N of 3".
- **Step 0 Welcome slides:** a few swipeable cards — what each tab does, "AI coaches, you write", and a privacy line incl. "anonymous usage metrics are on — you can turn them off in Settings." "Get started" on the last slide.
- **Step 1 Welcome:** wordmark, one line, "Get started" primary.
- **Step 2 Pick your AI:** three equal cards — "Use my subscription" (Recommended badge, brand-outlined), "Paste an API key", "Run free on my PC". Each: icon, title, one-line plain description. Selecting one expands its minimal inputs inline (e.g. sign-in button / key field / model picker). A "Not sure? Start here" hint points at the recommended card. "Continue" disabled until validated (a test call).
  - **Per-choice warnings (plain language):** API path → "This uses your paid credits — you can set a budget later in Settings." Cloud (subscription/API) → "Your questions and notes are sent to [provider]." Weak local model → "This model runs free on your PC, but answers and quiz grading may be less reliable — fine for studying, choose a cloud model for serious project work." Warnings update with the selected model.
- **Step 3 Setup (auto):** no choices. Single progress bar + status text cycling through plain-language steps ("Setting up your study brain", "Downloading the course", "Almost there"). On finish, auto-advance.
- **Finish:** "You're ready" + "Take the 30-second tour" → lands in Tutor with a sample question pre-filled and the Tutor tour starting.

### 5.2 Tutor (default) — a guided study surface, not a chat box
Two panes:
- **Left: course navigator (~260px).** A tree the student actually thinks in: **Course → Learning Unit → lesson**. Picking a course sets the tutoring context. Two view toggles at the top of the navigator:
  - **Learning materials** — browse/read the lesson pages and readings (serif reading pane) with their sources.
  - **Webinar summaries** — the class-recording study notes per session (date + topic), readable inline.
- **Right: tutoring panel** scoped to the selected course/lesson — ask anything, get cited answers (**source chips** under each), with a **concept illustration** (§3.6) shown when one anchors the idea. Starter chips are contextual to the selected lesson. A capture (bookmark) button saves a snippet to the student's brain.
- A breadcrumb shows the active course/lesson; switching lessons re-scopes the tutor.
- Empty state (first run): "Pick a course on the left to start studying" + 3 starter chips + the sample question.

### 5.3 Quiz — gamified active recall, multiple formats
- **On demand:** a "Quiz me" entry point that's always available (also reachable from Tutor's current lesson). Questions may repeat within a course/LU across sessions — that's fine (reinforcement).
- **Pre-quiz / home:** pick course/week/topic + length; a **results dashboard** above it — past attempts (score, date), accuracy trend, and a **gamification strip** (XP, current streak, level/badges, weak-spot list). **XP accrues per quiz taken**, not only per correct answer — practice is rewarded. ("Compete with the cohort" leaderboard is a later, opt-in addition.) "Start" primary.
- **Question formats (mix per quiz):** multiple-choice, true/false, **free-form** (typed answer, AI-graded against source with citation), and **drag-to-order** (sequence steps/events — e.g. order Bardach's steps, or a causal chain). Each format has its own card layout; one question per card, centered.
- **During:** summary row (course/week · "Question 3 of 10" · streak) + thin progress bar. Reveal shows the correct answer with **citations**, a short why, and (where it helps) a concept **illustration**. Self-grade control on free-form (got it / partial / missed).
- **End:** score, XP earned, streak update, weak-spot line ("Weak spot: elasticity — more coming up"), and "Review missed" / "Retry weak spots".
- Empty state: "Pick a week to test yourself."

### 5.4 Research — conversational, with history and highlight-to-Notebook
Two panes:
- **Left: conversation history (~240px).** Saved threads (title + date); click to reopen and continue. "New research" at top.
- **Right: the thread.** A prominent question/search field; **answer blocks** with inline numbered citations `[1][2]`; a **sources list** (numbered, title + source kind: course reading / web domain, click to open).
- **Highlight → Notebook (the key interaction):** the student selects any span of an answer → a floating "Add to Notebook" action appears → choose/create a Notebook page → the highlight is saved **with its source carried as a bibliography entry** on that page (§5.5). A toast confirms ("Saved to *Demand & supply* with source").
- Follow-up chips + a "Send to a project" action.
- Empty state: "Ask a research question for your assignment or capstone."

### 5.5 Notebook — the student's pages, with sources attached
A classy, calm notebook that is the connective tissue between Research and Projects.
- **Left: page index (~240px)** + a search box (searches titles + note text + sources). "New page" at top. Pages are titled and reorderable.
- **Right: the page.** The student's notes (serif reading pane, lightly editable), each saved snippet showing where it came from. A **"Sources / bibliography" block pinned at the bottom of every page** lists each source carried in (course reading, webinar, web domain) as a citation with a link back to the original and to the research thread it came from.
- **Inbound:** highlights from Research (§5.4) land here with their source auto-attached; Tutor captures can too.
- **Outbound:** "Use in a project" pulls a page's notes **and its bibliography** into the active Project draft's evidence (§5.6).
- Empty state: "Highlight anything in Research to start a page."

### 5.6 Projects — assignment-driven, scaffolds but never writes
- **List view (Projects):** three kinds, grouped — **Assignments** (live list pre-loaded from Open Takshashila: title, course, **due date** soon/overdue, details on expand), the **Capstone** (one long-running thread that persists across the programme), and **Personal writing** (student-created, free topic — a Substack post, an op-ed). In-progress cards show "% through framework · last edited · saved ✓". "New project" → assignment / capstone / personal. Picking one opens its workspace (creates it on first open).
- **Editor view (split):**
  - Left rail (~200px): the scholar framework as a checklist — **Bardach's 8 steps** (Define problem · Assemble evidence · Construct alternatives · Select criteria · Project outcomes · Confront trade-offs · Decide · Tell your story) with done/active/todo states. The active step shows its **India lens** as a small hint chip ("State capacity?", "Union/State/Concurrent?", "Better-or-worse"). A "Review draft" entry runs argument critique + values review (the four commitments) + causal check.
  - Right pane: the student's **draft editor** (serif reading font); an **evidence panel** to pull in Notebook pages (notes + bibliography) and Research findings; AI **coach notes** in the margin.
  - **No-write enforcement (the integrity core — see PRD §8.5/§9):** the assistant brainstorms (Socratic), guides the scholar steps, retrieves evidence, and **proofreads** — corrections/clarity/structure shown as *tracked suggestions on the student's own text* (accept/reject). It will **not** generate the deliverable's prose. Every generation passes a guard that blocks substantive ghostwriting (with a brief, visible "I can coach and proofread, but you write this part" message + the min-time-lag nudge). The toolbar reflects this: *Brainstorm · Find evidence · Stakeholder map · Proofread · Review draft* — there is no "Write it for me".
  - Top banner: "It's a scaffold, not a shortcut — AI coaches, you write. Disclaimers auto-added." Autosave indicator. The 8-step flow yields a Policy Analysis Memo → brief + PPT. (No-write coaching applies to **every** project type — it builds the writing habit even on personal pieces. Personal projects only **omit the academic disclaimers + plagiarism checklist**, since they aren't course submissions; see PRD §8.5.)
  - Export action: produces the brief (+ PPT outline) with the policy disclaimers pre-inserted, the **bibliography assembled from the pulled-in sources**, and a plagiarism-checklist reminder.
- Save/resume: autosave continuously; reopening a project restores the step, draft, and attached evidence.

### 5.7 Per-tab tours
- Trigger on first visit to each tab; 2–4 spotlight steps highlighting key elements with one-line explanations. "Next" / "Got it" / "Don't show again". Replayable from a "?" button in each tab header.

### 5.8 Settings
- Sections: **Profile** (display name + a short, length-capped "How should the AI talk to you?" custom-instructions field — soft preamble, can't override the no-write guard/citations), AI engine (change/sign out, swap model/key), Course library (sync status, force sync), Study brain (location, reset), Tours (replay any), Privacy, About (version, check for updates).
- **Privacy section:** plain-language summary ("everything stays on your computer") + an **anonymous usage metrics toggle** (on by default, explained: "helps us see the app is being used — never your questions, notes, or name"). A **Submit feedback** button (short form, attaches app version, nothing personal unless typed).
- **Spending (API path only):** a monthly **budget** the student sets, a **spend indicator** ("₹/$ used this month" + a bar toward the budget), and a per-session estimate before expensive actions (a Research fan-out / a Projects review). At budget, the app warns and pauses paid calls rather than silently spending. Hidden entirely for subscription/local paths.

## 6. States (design all of them)

For every data surface specify: **loading** (progress + label), **empty** (icon + line + primary action), **error** (plain message + retry + "what to do"), **offline** (works on last-synced library, banner "Showing your last download — connect to sync"), **success/saved** (quiet confirmation). No raw error codes or stack traces ever shown to students.

## 7. Accessibility

- WCAG AA contrast in both light and dark.
- Full keyboard navigation; visible focus rings; logical tab order.
- Screen-reader labels on all icon-only controls; live-region announcements for "saved", "synced", "answer ready".
- Respect reduced-motion (tours/transitions degrade gracefully).
- Minimum 12px text; comfortable line length in reading panes (~70–80 chars).

## 8. Motion

- Subtle and purposeful: 120–200ms ease for tab switches, tour spotlights, message entry. Nothing bouncy. Honor reduced-motion.

## 9. What to align later

- Replace the proposed palette/wordmark with **official Takshashila brand** once available.
- Confirm the **reading serif** choice with a real transcript and a real policy brief.
- Validate the **wizard and per-tab tours** by watching one non-technical cohort-mate go through them unaided (the real test).

---

## 10. Design Review — Locked Decisions (2026-06-29)

Outcome of `/plan-design-review` (full sweep, all five surfaces + wizard, calibrated
against this DESIGN.md and six AI mockups). Initial design completeness: **7/10**.
Pass ratings (before fixes): Info Arch 6, States 5, Journey 6, AI-Slop 7, Design-System 6,
Responsive/A11y 4. The mockups confirmed strong, calm, non-sloppy craft but surfaced
structural gaps. Five decisions, all resolved toward "specify now":

- **D3 — Unified app shell (Info Arch + Design System).** Built faithfully, each surface
  resembled a *different* app (the mockups drifted into Perplexity / Notion / a quiz
  dashboard). Lock a single persistent shell as a hard contract: identical 160px sidebar
  (same wordmark, same 5 nav items + order, same engine/sync/Settings block) on every
  surface; the **per-tab accent is the only thing that changes**; a shared component
  vocabulary (source chip, card, chip, progress bar) reused verbatim across tabs. **Fix
  the surface count to 5 everywhere** (PRD §4 "four" → five; resolves Codex #5). This is
  what makes five interaction models read as one study brain (Principle 7).
- **D4 — Per-surface interaction-state table (States).** Replace the §6 directive with an
  actual table: for each surface, what the user SEES for loading / empty / error / offline /
  engine-unavailable. Empty states designed as features (warmth + one primary action +
  context). Priority on offline/sync and engine-down states (flaky bandwidth + BYO engine).
- **D5 — Wizard agent-CLI auth flow (Journey).** The recommended default's auth is the
  hardest onboarding moment and had no UI. **It is NOT a Google/OAuth login** (the mockup
  invented that and it is wrong). "Use my subscription" = the student picks **which AI
  provider they have a plan with — Claude (Claude Code CLI) or ChatGPT/OpenAI (Codex CLI)** —
  and the app drives *that* CLI's own sign-in. Design it as explicit wizard sub-states:
  choose provider (Claude / ChatGPT) → detect that provider's CLI present → if absent,
  plain-language "install your AI" step (copy-paste command/link + "check again") → if
  present-but-unauthenticated, hand off to the CLI's native login → "connected ✓" success →
  API-key fallback when it won't work (ties to PRD eng-review D4). The other two cards stay:
  "Paste an API key" (OpenAI / Anthropic / OpenAI-compatible) and "Run free on my PC" (local).
- **D6 — Responsive reflow + pane focus (Responsive/A11y, was 4/10).** Add per-viewport
  reflow rules for every multi-pane surface (what collapses to a drawer/tab at the ~960px
  floor, what stays) + an explicit pane reading/focus order and ARIA landmarks per pane.
  Projects (four columns) needs a defined narrow layout.
- **D7 — Projects progressive disclosure (Unresolved → resolved; T12 / Codex #10).** The
  four-column editor violates "one primary action per screen." Make the **draft editor the
  primary focus**; show only the **active Bardach step** expanded (others collapse to a slim
  checklist); collapse the **evidence panel into a summon-on-demand drawer** (opens on "Find
  evidence" / "Use in a project"); show **coach notes inline** at the relevant line, not as a
  permanent margin column. Toolbar unchanged. Keeps every capability, stops them shouting at
  once (Principle 8).

**Deferred to TODOS.md:** dark-mode variants + contrast audit (D9); Takshashila brand /
wordmark / palette alignment (D10).

## 11. Approved Mockups

Reference renders for implementation (provisional scholarly palette; regenerate after
Takshashila branding lands). Calm, scholarly, AI-slop-free craft confirmed.

> **These mockups are NON-BINDING placeholders.** They were AI-generated and contain
> spec inaccuracies (wrong wordmarks like "Scholaris"/"Perplexity"/"Notiora", drifted
> sidebar nav, a Google login button on the wizard, etc.). Build from the **design system
> (§3) and the locked decisions (§10)**, NOT from the pixels. Use the mockups only for
> **general layout and direction** (pane structure, content placement) — every label,
> brand, and control is authoritative in the spec, not the render.

| Screen | Mockup Path | Notes / constraints from review |
|--------|-------------|----------------------------------|
| Tutor (home) | ~/.gstack/projects/diwakarss-takshashila-pgp-guide/designs/pgp-guide-screens-20260629/01-tutor.png | Reference for the unified shell (D3). Two-pane reads cleanly. |
| Wizard (Pick your AI) | …/02-wizard.png | Clean; but agent-CLI auth needs the D5 sub-states (mockup's Google button is wrong). |
| Quiz (home) | …/03-quiz.png | Gamification calm, not childish. Watch reward illustration staying intentional not decorative. |
| Research | …/04-research.png | Perplexity-style as intended; must wear the unified shell (D3), not its own identity. |
| Notebook | …/05-notebook.png | Bibliography block at page bottom works; apply shared chrome (D3). |
| Projects (editor) | …/06-projects.png | Shows the density problem — rebuild per D7 progressive disclosure. |

## 12. Design — NOT in scope (v1)

- Full dark-mode variant set + contrast audit — TODOS.md (palette provisional).
- Final Takshashila palette/wordmark — TODOS.md (external dependency).
- Per-tab tour *content* design — implementation-time, alongside each surface.
- Mobile/native layouts — desktop-only per PRD non-goals.
- Cohort leaderboard UI — PRD §8.3, deferred feature.

## 13. Design — What already exists (reuse)

- This DESIGN.md design system (tokens, type scale, spacing, components, motion) — the
  reuse base; D3 makes its shell + component vocabulary a hard contract.
- The office-hours reference mockup (app shell + tabs + wizard) — the structure to match.
- The six approved mockups above — visual reference per surface.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 10 missed-problem findings, 3 actioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 10 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score 7/10 → 9/10, 5 decisions, 6 mockups |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** outside voice (eng review) surfaced corpus legality/governance, telemetry-trust, MVP-thesis, 4-vs-5 scope bug; design review resolved the 4-vs-5 contradiction via the unified-shell decision (D3).
- **CROSS-MODEL:** eng + design agree the agent-CLI default is the highest-friction onboarding path (builder kept it, hardened via eng-D4 + design-D5).
- **VERDICT:** ENG + DESIGN CLEARED — both reviews complete, 0 unresolved decisions. Plan is design-complete (6/7 passes at 8+ after fixes); 5 design decisions + 7 design tasks landed. Run /ship when implementation is ready; run /design-review after build for visual QA.

NO UNRESOLVED DECISIONS
