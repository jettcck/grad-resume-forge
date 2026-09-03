# Grad Resume Forge 🔥

[![CI](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml)
[![Release](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](./LICENSE)
[![中文说明](https://img.shields.io/badge/README-中文-red.svg)](./README.zh-CN.md)

A local-first desktop app that helps CS new grads **write resumes, de-AI-flavor them, and track job applications** — powered by a hybrid **deterministic rules engine + LLM agent** architecture.

> 💡 **Why "de-AI-flavor"?** Recruiters increasingly reject resumes that smell like ChatGPT. This app rewrites your real experience into strong, quantified, human-sounding bullets — and every LLM output must pass a **deterministic validation gate** before it can touch your profile.

## ✨ Features

- **Import your old resume** — drop a PDF/TXT, a local parser (pdf.js + China's MOE university list) fills the forms for you
- **De-AI-flavor engine** — deterministic rules strip clichés, upgrade weak verbs, and preserve every metric; a 0-100 audit score updates live
- **JD precision matching** — paste a job description, see exactly which required skills your resume hits or misses
- **Agent deep-optimization** — an LLM rewrites your bullets against a specific JD, but each output must pass the validation gate (cliché / lost numbers / score regression → rejected & regenerated). Human-in-the-loop: you approve every rewrite with a checkbox
- **Application kanban** — track wish → applied → interviewing → offer, with one-click links to job platforms
- **Local-first** — all data stays on your machine (scrypt-hashed credentials), works offline, zero telemetry
- **Auto-update** — silent download via GitHub Releases, with an optional mirror prefix for users in China

## 🏗️ Architecture

The core idea: **the LLM generates, but deterministic rules are the quality gate.**

```
LLM rewrite ──▶ Validation Gate ──▶ accepted: applied to profile (with diff review)
                    │  rejects: cliché / dropped metrics / >80 chars / audit score down
                    └──▶ regenerate with machine-readable feedback (max N rounds)
```

```
Electron
├── main process
│   ├── resume-engine.js    deterministic engine: rewrite / audit / JD match
│   ├── agent.js            agent runtime: tool registry + validation gate + regen loop
│   ├── llm-client.js       Ollama (local) or any OpenAI-compatible cloud (BYOK), SSE streaming
│   ├── resume-importer.js  PDF/TXT resume parser (school lookup, section mapping)
│   └── store.js            atomic JSON store
├── renderer
│   └── app.js              3 views: profile editor / resume preview / application board
└── evals/                  two-layer evals: golden cases (CI gate) + LLM offline eval
```

**LLM privacy options** — use a fully local Ollama model (nothing leaves your machine), or bring your own cloud API key (DeepSeek / Kimi / Qwen / OpenAI; the key is stored locally only). No key is ever bundled.

## 🚀 Getting Started

```bash
npm install
npm start          # launch the app
npm test           # full suite: 194 assertions + rule-layer evals
npm run eval       # rule-layer golden-case evals
npm run eval:llm   # LLM-layer evals (requires local Ollama)
```

### Enable Agent optimization (optional)

Either:
- **Local**: install [Ollama](https://ollama.com) → `ollama pull qwen2.5:7b` (nothing leaves your machine), or
- **Cloud**: in-app ⚙ config → Cloud API → pick a preset → paste your own API key

Everything else works without any model.

### Build & Release

Fully automated pipeline — push to test, tag to release:

```bash
npm version patch        # bump version (commits + tags)
git push --follow-tags   # CI builds the Windows installer & publishes to Releases
```

- **CI** runs syntax checks + the full test suite on every push/PR
- **Release** (tag `v*`) verifies tag↔version consistency, re-runs tests, then builds and publishes
- Local packaging for personal use: `npm run dist` (explicitly `--publish never`)
- Building behind restrictive networks (e.g. mainland China): `npm run dist:local` — one command that mirrors the winCodeSign binary, applies idempotent runtime patches to `app-builder-lib`, and serves binaries from a local HTTP source. Safe to re-run after `npm install`.

## 📊 Testing & Evals

| Suite | Scope | Command |
|---|---|---|
| Engine | rewrite / audit / matching / word-boundary regressions | `node test-engine.js` |
| Importer | Chinese resume parsing / PDF extraction | `node test-importer.js` |
| Agent | validation gate / regen loop / streaming / cloud client (mocked end-to-end) | `node test-agent.js` |
| E2E | register → login → profile → generate → applications | `node test-e2e.js` |
| Updater | publish config / mirror rules / pipeline assertions | `node test-updater.js` |
| Rule-layer evals | 19 golden cases as a regression gate | `npm run eval` |
| LLM-layer evals | success rate / acceptance / score deltas on real model | `npm run eval:llm` |

## 📄 License

[MIT](./LICENSE) © jettcck
