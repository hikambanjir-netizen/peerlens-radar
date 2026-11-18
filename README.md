# peerlens-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hikambanjir-netizen/peerlens-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hikambanjir-netizen/peerlens-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

PeerLens is a token launch radar: it ranks the protocols that record no token yet by what a launch would be worth, priced entirely from the launches that already happened.

The model is an ensemble of eight partially pooled fits over the snapshot's launched protocols. Each fit starts from a size line (log market cap against log TVL, slope ≈ 0.52), then averages each protocol's winsorised residual within its category and its primary-chain ecosystem, shrunk toward zero by group size — a category with four launches moves the estimate far less than one with forty. Small fixed tilts for seven-day TVL momentum and years run with no token follow, and one calibration multiplier (the leave-one-out median actual/predicted) removes the systematic bias.

Validated the hard way — leave-one-out over all 128 launched protocols that record both a TVL and a market cap: Spearman rank correlation 0.437 between predicted and actual market caps, median predicted/actual 0.959 before calibration and 1.000 after. The board holds 198 pre-token candidates (every protocol that records no token, minus wrapped, staked, bridged and versioned products of tokens that already trade), covers all 40 house watchlist protocols, and gives every row a five-step farm plan with costs and times. The dashboard shows the board, a per-protocol detail view with the model's layer-by-layer working and its launched peers, filters, and the full method.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
node tools/backtest.ts /path/to/snapshot.json   # reproduce the validation numbers
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=dfkzjsa3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
