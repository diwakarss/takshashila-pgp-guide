# PGP Guide

A **local-first desktop study companion** for the Takshashila Institution's Post-Graduate
Programme in Public Policy (PGP). Everything — the course library, your notes, quiz
history, assignment drafts — lives on your computer. The AI coaches; it never writes
your submissions.

## Install (students)

Grab the latest installer from **[Releases](../../releases)**:

| OS | File | Note |
|---|---|---|
| macOS (Apple Silicon) | `PGP-Guide-<version>-mac-arm64.dmg` | Unsigned: first open via right-click → **Open**, or System Settings → Privacy & Security → **Open Anyway** |
| Windows 10/11 (x64) | `PGP-Guide-<version>-win-x64.exe` | Per-user install, no admin. SmartScreen will warn: **More info → Run anyway** |

**First run** walks you through two steps:

1. **Connect your AI** — a Claude/ChatGPT account you already have (via their CLI, the
   wizard handles installation), an API key, or a fully local model (Ollama). Switchable
   later in Settings.
2. **Download the course library** — one click; class access is built in. The first
   import embeds everything locally and takes ~15–20 minutes. After that the tutor and
   quiz work offline.

New classes, readings, and assignments arrive weekly — the sidebar shows a **"N new"**
pill; click it (or Settings → *Get latest classes*).

## What's inside

- **Tutor** — course-grounded teaching with citations into the actual class transcripts
  and readings, plus a reusable illustration library.
- **Quiz** — mixed-format quizzes per course, scoring history, streaks, weak-spot review.
- **Research** — web-first policy research (Perplexity-style, bent for policy students):
  structured lenses, cited answers.
- **Notebook** — highlight → capture from any answer, with sources preserved; notes keep
  their bibliography.
- **Projects** — guided assignment flows with an AI **coach, not a ghostwriter**: it
  researches, you decide and write. Assignment briefs sync from the course hub
  automatically; exports carry the required anti-plagiarism and AI-use disclaimers.

**Privacy:** everything stays on your machine. The only network calls are your chosen
AI, the course-content server, and (opt-in) a single anonymous launch ping — no
questions, notes, or names, ever. Toggle it in Settings → Privacy.

## How course content flows

```
OpenTakshashila hub ─▶ weekly ingest (pgp-brain repo: transcribe, notes, assignments)
                        └▶ publish ─▶ Cloudflare Worker (KV) ─▶ app "Get latest classes"
```

The corpus pipeline lives in the private **pgp-brain** repo (`tools/ingest`,
`tools/publish`). This repo's `tools/corpus-worker` and `tools/telemetry-worker` are the
two Cloudflare Workers (deploy with `npx wrangler deploy` inside each).

## Development

```bash
npm install
npm run dev          # electron-vite dev app
npm run typecheck
npm test             # vitest unit suite
```

Dev safety rails (hard-learned):

- The brain (PGLite) is **single-process**: never run two instances against one data
  dir, and never SIGKILL the app mid-import.
- Every dev probe (`PGP_DEV_*` env vars in `src/main/index.ts`) refuses to run without
  `PGP_USERDATA` pointing at an isolated directory — keep it that way.
- Don't edit watched sources while a dev-mode probe is running; the rebuild restarts
  Electron underneath it.

### Building installers

```bash
# one-time: fetch the Node runtimes bundled into the app (the embedder runs in a
# system-Node child process; students don't have Node installed)
V=v22.14.0
mkdir -p build/node/darwin-arm64 build/node/win-x64
curl -sL "https://nodejs.org/dist/$V/node-$V-darwin-arm64.tar.gz" | tar -xz -C /tmp "node-$V-darwin-arm64/bin/node" \
  && mv "/tmp/node-$V-darwin-arm64/bin/node" build/node/darwin-arm64/node
curl -sL -o build/node/win-x64/node.exe "https://nodejs.org/dist/$V/win-x64/node.exe"

npm run build:mac    # dmg (arm64)
npm run build:win    # NSIS (x64), cross-built on macOS
```

Then attach the artifacts in `dist-installers/` to a GitHub release. Builds are
unsigned by design for cohort distribution; macOS is Apple-Silicon-only for now
(onnxruntime ships no darwin/x64 binding here).

### Repo layout

| Path | What |
|---|---|
| `src/main` | Electron main: brain (PGLite+pgvector), corpus import/sync, engines (Claude/Codex/API/Ollama), coach/tutor/quiz services, embedder child |
| `src/renderer` | React UI: the five tabs, wizard, sidebar |
| `src/shared/ipc.ts` | The typed IPC contract + project step plans |
| `tools/` | Cloudflare Workers: corpus delivery, anonymous telemetry |
| `scripts/` | Dev harnesses (sync test, smoke probes, afterPack hook) |
| `PRD.md` / `DESIGN.md` / `TODOS.md` | Product spec, design system, deferred work |

## Known limits (v0.1)

Unsigned binaries (see install notes) · no auto-update yet — new versions land on the
Releases page · macOS arm64 only · the capstone project plan is deliberately undesigned
until the course defines it.
