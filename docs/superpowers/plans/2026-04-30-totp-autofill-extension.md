# TOTP Autofill Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only Chrome MV3 extension that imports Aegis/Google Authenticator TOTP accounts, generates codes locally, matches the current website, and fills a 2FA input on demand.

**Architecture:** Keep all sensitive logic in dependency-free ES modules under `src/core`, with tests runnable by Node. Chrome-specific files (`popup`, `options`, `background`, `content`) are thin adapters around those core modules. Storage is intentionally `chrome.storage.local` without a master password because the user selected convenience over encryption for the first local-only version.

**Tech Stack:** Chrome Manifest V3, browser/Node WebCrypto, vanilla JavaScript ES modules, Node built-in test runner.

---

### Task 1: Core behavior with TDD

**Files:**
- Test: `tests/core.test.mjs`
- Create: `src/core/base32.js`, `src/core/totp.js`, `src/core/importers.js`, `src/core/matcher.js`

- [x] Write failing tests for RFC TOTP vector, otpauth parsing, Aegis plain JSON import, Google Authenticator migration protobuf import, and domain matching.
- [x] Run `npm test` and verify tests fail because modules do not exist yet.
- [x] Implement minimal dependency-free core modules.
- [x] Run `npm test` and verify tests pass.

### Task 2: Chrome extension shell

**Files:**
- Create: `manifest.json`, `src/background.js`, `src/popup.html`, `src/popup.js`, `src/options.html`, `src/options.js`, `src/content/autofill.js`, `src/styles.css`, `README.md`

- [x] Add MV3 manifest with `storage`, `activeTab`, and `scripting` permissions only.
- [x] Add popup UI for matched entries, code display, countdown, copy, and fill.
- [x] Add options UI for Aegis JSON import, otpauth/Google migration URI import, optional QR image decode via `BarcodeDetector`, entry search, and delete-all.
- [x] Add content script function to fill likely OTP inputs and dispatch input/change events.

### Task 3: Verification

**Files:**
- Verify all files under `/Users/heqifeng/totp-autofill-extension`

- [x] Run `npm test`.
- [x] Add encrypted Aegis import support with password-based scrypt + AES-GCM decryption after user hit the encrypted-backup limitation.
- [x] Run syntax checks on all extension JS files with `node --check`.
- [x] Confirm no network permissions in `manifest.json`.
