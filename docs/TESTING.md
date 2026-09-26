# Testing — Phase 3

Latest executed results in the Phase-3 working tree:

- Python biometric suite: **124 passed, 0 failed**
- TypeScript suite: **58 passed, 0 failed** using Node's experimental type stripping runner

The suite covers model failure, image/input limits, frame limits, duplicate-frame replay evidence, PASS3D sequence/pose logic, SFace pipeline contracts, watchlist precedence and the raw-evidence authority boundary.

`npm run typecheck` and a production Vite build were not claimed because `node_modules` was absent in the validation environment.

Physical camera validation remains **NOT VALIDATED**.
