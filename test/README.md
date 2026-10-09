# Tests

| Path | What it is |
| --- | --- |
| `skill.test.js` | Documentation contracts: frontmatter and discovery, the resource map, no leaked machine paths or secrets, and the corrections that were verified against real projects |
| `plan.test.js` | Behaviour of `scripts/plan.mjs`, driven by generated fixtures |
| `install.test.js` | Behaviour of `scripts/install.mjs`, driven by a throwaway `HOME` |
| `fixtures/` | Tiny per-ecosystem projects used by `scripts/verify-commands.mjs` — **not** by the unit test run |

```bash
npm test               # node --test test/*.test.js
npm run verify         # runs the documented commands against fixtures/
npm run verify:network # also runs the Maven case
```

`npm test` names its files explicitly on purpose: Node's test runner treats every
file under a `test/` directory as a test file, so `fixtures/node/src/index.js`
would otherwise be executed as a test and fail on its `left-pad` import.
