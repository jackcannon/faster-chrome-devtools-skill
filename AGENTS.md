## About this project

This repo is a published, shareable agent skill and dependency-free Node.js CLI
for direct Chrome DevTools Protocol usage. `SKILL.md` is the skill itself (for
agents), `scripts/cdp.mjs` is the CLI, and `README.md` is for humans. The CLI
must continue to work without Chrome DevTools MCP, Puppeteer, Playwright, or npm
runtime dependencies.

## Keep it portable

This skill is used by many people with different setups. Anything written into
`SKILL.md` must be generally relevant, not specific to one person's machine or
config.

- Don't hardcode account IDs, absolute file paths, tokens, or personal CLI
  tools. Use generic placeholders where a value is required.
- Keep endpoint configuration portable. Support explicit WebSocket and HTTP
  discovery endpoints in addition to local Chrome discovery.
- MCP may be documented as an optional compatibility path, but must not be a
  requirement.
- When adding guidance learned from real usage, state the behavior and the fix,
  not the personal context it came from.
- Before committing an edit, re-read the diff for anything that only makes sense
  on the author's machine, and generalize or omit it.

## Tests

Run `node --test` plus `node --check` on both CLI modules after changing the
implementation. Tests must not require Chrome, a network service, or package
installation.

## Keeping this file current

Update this AGENTS.md whenever the project's structure or conventions change in a
way that future edits should know about.
