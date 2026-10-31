# Contributing

## Running the service

The service lives in `service/` and needs Node 22 or newer.

```bash
cd service
npm install
npm test
```

Before opening a pull request, make sure these all pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run format` to apply Prettier.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/), for example
`feat: add session registry` or `fix: handle empty pty output`. Keep each commit to one logical change.
