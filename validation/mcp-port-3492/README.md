# MCP port feedback native validation

Bounty issue: https://github.com/tari-project/universe/issues/3492

Patch: e2cc0436b9dd95cc7b60efc71ca9bd6d5bc86ff5, based on e6333ccfd52e92c7b991d0565ce2cfa85ab46e05.

Exact base: e6333ccfd52e92c7b991d0565ce2cfa85ab46e05. Build run42782291324; executable SHA-256 afaa0e3534316b888bfb8a5e601ac8d5f234bf67aa9fdfb966f79ac3d9adb2c5. Runtime run42789805489 at 2026-11-10T09:20:51.018Z, Windows Server2025 GitHub runner and WebView2 156.0.4314.58. Production frontend, real native Rust backend, no test mode; ephemeral testnet profile with mining/autoupdate/telemetry disabled. No mainnet wallet, funds or project credentials used by the app.

The driver is in ../../.github/scripts/mcp-port-native-runtime.mjs and setup in ../../.github/workflows/mcp-port-native-runtime.yml. A real loopback listener occupies4444; real UI actions test invalid text/range, both busy-port paths, preserved configured state and recovery on4445. No random fallback. Unauthenticated real HTTP receives401. Both busy failures log port4444 and OS error10048. result.json retains timestamps and relevant logs. Screenshots mask the token field; no token was revealed.

The compile and runtime scripts were added only on verification branches; the bounty branch contains the eight-file implementation patch alone. Frontend checks:16 new cases,28 focused passes,79files/1385full-suite passes, TypeScript and changed-file ESLint pass. Full suite printed a Vite close-timeout warning after exit0. Native Linux/macOS behavior has not been tested.

Historical harness failures are retained in runs42786568945,42787305144,42788099083 and42789442707. WebView2v150+ elevated-host policy was configured according to Microsoft's documented app-specific HKLM settings on an already-admin ephemeral runner; no local host policy or application manifest was changed. The final harness also waits for and normally dismisses the asynchronously arriving Release Notes modal. No acceptance assertion or application behavior was weakened.

This is validation evidence, not maintainer acceptance, a prize award or a payment.
