# Contributing

## Running the service

The service lives in `service/` and needs Node 22 or newer. Use Node 22.23.x (what CI runs) or
24.22 or newer: on Node 24.15.0 a known libuv crash (exit code 0xC0000409, a failed stack-cookie
check in `uv_tcp_connect`) kills a vitest worker in about one run in forty.

```bash
cd service
npm install
npm test
```

Before opening a pull request, make sure these all pass:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Use `npm run format` to apply Prettier. If you changed the protocol schemas, also run
`npm run protocol:emit` and commit the regenerated `protocol/afk-protocol.schema.json`.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/), for example
`feat: add session registry` or `fix: handle empty pty output`. Keep each commit to one logical change.
