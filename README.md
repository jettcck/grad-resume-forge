# Grad Resume Forge 🔥

[![CI](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml)
[![Release](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](./LICENSE)
[![中文说明](https://img.shields.io/badge/README-中文-red.svg)](./README.zh-CN.md)

A local-first desktop app that helps new grads of every major **write resumes, de-AI-flavor them, and track job applications** — powered by a hybrid **deterministic rules engine + LLM agent** architecture.

> 💡 **Why "de-AI-flavor"?** Recruiters increasingly reject resumes that smell like ChatGPT. This app rewrites your real experience into strong, quantified, human-sounding bullets — and every LLM output must pass a **deterministic validation gate** before it can touch your profile.

## 🧭 Zero-barrier to start, AI is optional

Everything except AI rewriting works with **no model, no key, no setup** — install and use:

| Capability | Needs a model? |
|---|---|
| Profile editing · resume import · generation · PDF export | ❌ none — pure local |
| De-AI-flavor audit & 0-100 scoring | ❌ none — deterministic rules |
| JD precision matching | ❌ none — deterministic rules |
| Application kanban | ❌ none |
| Job-hunt assistant (built-in knowledge base) | ❌ none — local, offline |
| Agent deep-optimization (AI rewriting) | ✅ one of three channels below |

The three AI channels — pick whichever, switch anytime:

1. **In-app model** *(default, zero config)* — Qwen2.5-0.5B runs inside the app via WebGPU. One-time download of **~270–281 MB** through mainland-China-friendly mirrors (hf-mirror.com for weights, gh-proxy.com for the runtime lib) — **no VPN needed** — then it works fully offline. The app auto-picks the q4f16/q4f32 build for your GPU, with resumable retries on flaky networks. Needs a reasonably recent GPU (WebGPU).
2. **Local Ollama** — nothing leaves your machine.
3. **Cloud API key** (BYOK) — DeepSeek / Kimi / Qwen / OpenAI presets; the key is stored locally only.

## ⬇️ Download & install

Everything is on the [latest release](https://github.com/jettcck/grad-resume-forge/releases/latest) — no account, no key:

| Platform | File | Install |
|---|---|---|
| **Windows 10/11 (x64)** | `grad-resume-forge-setup-*.exe` | Run the installer (NSIS). Auto-updates. |
| **Linux (x64)** | `grad-resume-forge-*-x86_64.AppImage` | `chmod +x` it, then run. Auto-updates. |
| | `grad-resume-forge-*-amd64.deb` | `sudo apt install ./grad-resume-forge-*-amd64.deb` (installs to `/opt`, adds a menu entry). Manual updates. |
| **macOS** | — | not built yet |

Linux notes:
- **AppImage sandbox**: on distros that restrict unprivileged user namespaces (e.g. Ubuntu 24.04+), an Electron AppImage may refuse to start with a `SUID sandbox helper` / `namespace` error. Run it as `./grad-resume-forge-*.AppImage --no-sandbox`, or enable unprivileged user namespaces for your distro.
- Prefer the `.deb` if you want the app in your application menu; prefer the AppImage if you want to update automatically and keep nothing installed.

> Unsigned installers: Windows SmartScreen may warn ("unknown publisher") → *More info → Run anyway*.

## ✨ Features

- **Import your old resume** — drop a PDF/TXT, a local parser (pdf.js + China's MOE university list) fills the forms for you
- **De-AI-flavor engine** — deterministic rules strip clichés, upgrade weak verbs, and preserve every metric; a 0-100 audit score updates live
- **JD precision matching** — paste a job description, see exactly which required skills your resume hits or misses
- **Agent deep-optimization** — an LLM rewrites your bullets against a specific JD (in-app model / local Ollama / cloud BYOK — see the matrix above), but each output must pass the validation gate (cliché / lost numbers / score regression → rejected & regenerated). Human-in-the-loop: you approve every rewrite with a checkbox
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

**LLM privacy options** — the in-app model (Qwen2.5-0.5B via WebGPU, ~270–281 MB one-time download through China-friendly mirrors, then fully offline), a fully local Ollama model (nothing leaves your machine), or bring your own cloud API key (DeepSeek / Kimi / Qwen / OpenAI; the key is stored locally only). No key is ever bundled.

## 🚀 Getting Started

```bash
npm install
npm start          # launch the app
npm test           # full suite: 194 assertions + rule-layer evals
npm run eval       # rule-layer golden-case evals
npm run eval:llm   # LLM-layer evals (requires local Ollama)
```

### Enable Agent optimization

Recommended — **in-app model, zero config**: in-app ⚙ config → *In-app model* (default) → click *Download* (~270–281 MB via China-friendly mirrors, no VPN needed; auto-picks the build for your GPU; runs offline afterwards). Requires WebGPU.

Or, alternatively:
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
- **Release** (tag `v*`) verifies tag↔version consistency, re-runs tests, then builds and publishes — **Windows and Linux** (matrix over `windows-latest` + `ubuntu-latest`, serialized so both don't race on the same Release)
- **Build** (`build.yml`, manual dispatch or PR) builds all platforms with `--publish never` and uploads artifacts — use it to validate packaging config *before* tagging a release
- Local packaging: `npm run dist` (Windows) / `npm run dist:linux` (Linux). Linux targets **cannot** be built on Windows — the AppImage needs symlink privileges and the `.deb` needs `fpm`; both work on the ubuntu CI runner (free for public repos).
- `build/icon.png` + `build/icons/` are generated by `npx electron scripts/make-icon.js --no-sandbox`. Linux needs the multi-size directory: a single-file icon made electron-builder drop the icon into `hicolor/0x0/`.
- Building behind restrictive networks (e.g. mainland China): `npm run dist:local` — one command that mirrors the winCodeSign binary, applies idempotent runtime patches to `app-builder-lib`, and serves binaries from a local HTTP source. Safe to re-run after `npm install`.
- Pushing where `github.com:443` is unreachable: point git at a local proxy **for this repo only** — `git config http.proxy http://127.0.0.1:7890`. Repo-local (not `--global`) on purpose: a stopped proxy then breaks one repo instead of every repo.

#### Release gotchas — read before back-filling tags

**GitHub decides which release is "latest" by *publication time*, not by version number.**
`electron-updater` reads `GET /releases/latest`, so if you publish an **older** tag *after* a newer one, the pointer moves **backwards**: users on older builds are offered the older version and never see the newer one — they get stuck.

- **Publish in ascending version order.** If you really must back-fill old tags, finish by making the newest release the most recently published one again.
- The `make_latest` release field is **not** authoritative here — setting it (true on the newest, false on the old ones) did **not** move the pointer in practice.
- What does work: re-publish the newest release — `PATCH /repos/{owner}/{repo}/releases/{id}` with `{"draft":true}`, then `{"draft":false}`. Assets stay attached and `published_at` refreshes, so it becomes latest again. No re-upload needed.
- **Checklist after every release:**
  1. `curl -s https://api.github.com/repos/OWNER/REPO/releases/latest` → `tag_name` must be the version you just released
  2. Fetch that release's `latest.yml` and confirm `version:` matches (this is the file the updater actually reads)
  3. If a back-fill happened and step 1 fails, fix the pointer as above

## 📊 Testing & Evals

**240+ automated assertions**, run on every push (CI gate).

| Suite | Scope | Command |
|---|---|---|
| Engine | rewrite / audit / matching / word-boundary regressions | `node test-engine.js` |
| Importer | Chinese resume parsing / PDF extraction | `node test-importer.js` |
| Agent | validation gate / regen loop / streaming / cloud client (mocked end-to-end) | `node test-agent.js` |
| E2E | register → login → profile → generate → applications → snapshot restore | `node test-e2e.js` |
| Updater | publish config / mirror rules / pipeline assertions | `node test-updater.js` |
| Zero-barrier guard | in-app model loading shape / China mirrors / CSP / honest copy | `node test-embedded.js` |
| Rule-layer evals | 32 golden cases as a regression gate | `npm run eval` |
| LLM-layer evals | dual-mode comparison on a real model | `npm run eval:llm` |

### Real-model evals (deepseek-chat, Sep 2026)

Same JD, same profile, both modes, 4 cases (backend / frontend / algorithm / **finance** — tech and non-tech majors alike):

| Metric | Pipeline | Agentic (function-calling) |
|---|---|---|
| Success rate | 100% | 100% |
| Gate acceptance | 100% | 100% |
| Avg rounds/steps | 1.0 | 3.0 |
| Audit score gain | +7.5 | **+15.0** |
| JD coverage gain | **+25.8pp** | +13.0pp |
| Avg latency | 1.1s | 3.9s |

> On the finance case (non-CS major), the agentic mode lifted the audit score 61→88 and
> JD coverage 88%→100% — clichés like “认真负责…各项任务” are cleaned by the same
> deterministic gate. 100% gate acceptance across all majors means the constraints
> never falsely reject. Full data: `evals/llm-report.json`.

## ⚠️ Limits — what this app deliberately does *not* claim

We'd rather state the ceilings up front than let you hit them:

| Aspect | The honest reality |
|---|---|
| **De-AI-flavor is a rules engine, not a language model** | A curated lexicon + rewrite rules. It reliably kills *known* clichés (`赋能`/`抓手`/`闭环`/`leverage`/`robust`…) and never drops your numbers — but newly invented AI-speak or unfamiliar phrasings can slip through. Being deterministic is the point: auditable and reproducible (`npm run eval`). |
| **The lexicon is finite** | ~70 hard clichés + ~30 English GPT-isms, expanding by golden cases. Words that are *also* real terms (对齐 / 沉淀 / 复盘 / 闭环 / 生态) are **flagged, never auto-deleted** — deleting them would silently weaken your text. |
| **Empty adjectives are kept when they carry meaning** | “建立了**良好的**客户关系” must not become “建立了客户关系”. Adjectives before substantive heads (客户关系/业绩/经验/渠道/数据…) are preserved; only pure filler (“良好的沟通能力”) is removed. |
| **JD matching is lexical + weighted, not semantic** | Alias-based keyword matching with must-have (3×) / nice-to-have (1×) weighting, so stuffing bonus keywords cannot inflate the score. Common rephrasings are covered by aliases; a JD describing the same skill in a completely different way can still be missed — use **Agent deep-optimization** on the same JD for a semantic pass. |
| **The JD score is not a hiring prediction** | It measures keyword coverage of one posting. A screening aid, not a probability of getting an interview. |
| **Platform & maintenance** | Windows x64 and Linux x64 today (AppImage + deb); macOS is next. Maintained by one person. The eval suite, docs and CI exist to keep handover cost low, not to pretend otherwise. |
| **No large-scale user validation yet** | Early-stage project with a small user base. Published numbers are **reproducible eval results**, not testimonials or large-scale A/B data — treat feature claims accordingly. |

## 📄 License

[MIT](./LICENSE) © jettcck
