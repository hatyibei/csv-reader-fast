# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/hatyibei/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/hatyibei/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A drop-in, much faster reimplementation of csv-reader 1.0.0's exact semantics for broken CSV: quotes and doubled quotes, quote junk, unterminated quotes re-read as unquoted text, stray CRs, CRLF/LF inside quotes, BOM, short/long row padding and cutting, and the full {code, line, row} error stream in order. solve.js is a dependency-free ES module whose run(input) returns byte-identical {columns, rows, errors}; a single left-to-right scan cuts fields with slice, uses indexOf fast paths with monotonic position caches, and keeps a rewrite-segment list only for fields that need one. Verified byte-identical to the reference on the practice set and 4,700+ adversarial and fuzz cases, and roughly 7× faster on the practice corpus.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9zw8vvbd&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
