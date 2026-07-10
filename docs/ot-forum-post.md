# PGP Guide — a study companion I built for our cohort 📚🧭

Hi everyone! Over the last few weeks I've been building something for us, and it's finally ready to share: **PGP Guide**, a desktop app that turns everything we get each week — webinar recordings, learning units, readings, assignments — into a private, searchable study companion that lives entirely on your own computer.

## Why I built it

Two reasons. First, our course material is scattered: recordings in one place, learning units in another, readings as PDFs, assignments in email threads. I wanted **one place where I could ask a question and get an answer grounded in what was actually taught** — with citations to the exact class, not generic internet knowledge.

Second, I wanted AI help that respects how we're supposed to learn. So the app follows one rule everywhere: **the AI researches, coaches, and quizzes — you think, decide, and write.** It will not write your assignment. It will happily help you figure out what *you* think about it.

## What's inside

*(screenshots below each section)*

**🎓 Tutor** — ask anything about the course. Answers come from the actual class transcripts, learning units, and readings, with citations you can click to see the source. It can pull in hand-drawn concept illustrations (there's a library of 80+ now) and even fetch current web context when a question needs it.

**✍️ Quiz** — pick a course, get a mixed-format quiz drawn from what was actually covered. It tracks your scores, streaks, and weak spots, and levels you up over time. Shockingly effective the night before a webinar.

**🔍 Research** — for assignments and general curiosity: web-first policy research with structured lenses and cited answers. Think of it as a research assistant that shows its sources.

**📓 Notebook** — highlight anything in any answer and capture it as a note. Notes keep their citations, so when you come back three weeks later you know exactly where a point came from.

**📁 Projects** — the assignment workspace. Each assignment arrives automatically with its brief and due date, and opens as a guided, step-by-step flow (define the problem → gather evidence → weigh angles → draft). At every step the coach does legwork and asks questions — but the writing box is yours alone. Exports include the anti-plagiarism and AI-use disclaimers we're required to attach.

## The part I'm most pleased with: it stays current

Every week, new webinars are automatically transcribed (recordings → clean transcripts + AI study notes), and new learning units and assignments are picked up from the hub. When something new lands, the app shows a small "N new" pill — one click and the new material is searchable. International Relations LU-01–03 are already in there, alongside all webinars so far.

## Your AI, your choice

The app doesn't come with (or bill you for) an AI. On first run, a setup wizard connects one of:
- a **Claude or ChatGPT account** you already have (easiest),
- an **API key** if you have one, or
- a **fully local model** (Ollama) if you want nothing leaving your machine at all.

## Privacy, since it matters

Everything — the course library, your notes, quiz history, drafts — lives on your computer. The only network calls are to your chosen AI, the course-content server, and (optional, off by default is fine) a single anonymous launch ping. No accounts, no tracking, no cloud copies of your notes.

## Get it

Grab the installer from the **[Releases page](https://github.com/diwakarss/takshashila-pgp-guide/releases)**:

- **macOS (Apple Silicon):** download the `.dmg`. It's unsigned (no Apple developer cert yet), so on first open: right-click → Open, or System Settings → Privacy & Security → *Open Anyway*.
- **Windows 10/11:** download the `.exe`. SmartScreen will warn (same reason): click *More info → Run anyway*. No admin needed.

First run: connect your AI, click once to download the course library, and give it ~15–40 minutes to build its local index (one-time; it's embedding every class and reading on your machine). After that it works offline. Windows updates itself automatically from then on.

## It's ours — contribute!

The project is on GitHub: **https://github.com/diwakarss/takshashila-pgp-guide** — bug reports, feature ideas, and PRs are all welcome. It's an Electron + TypeScript app with a local vector database; the README has a full dev guide. If you spot a rough edge (you will — it's three weeks old!), open an issue, or just reply here.

Happy studying! 🙌

— Diwakar (PGP10)
