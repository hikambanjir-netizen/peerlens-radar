// Backtest for the PeerLens model: leave-one-out validation on the launched protocols.
//
//   node tools/backtest.ts [snapshot.json]
//
// Trains LaunchValueModel on the snapshot (default: the token-radar-01 kit's sealed input) and
// prints the numbers the dashboard's methodology section quotes: the size of the launched
// universe, the Spearman rank correlation between predicted and actual market caps, the median
// predicted/actual ratio before and after the model's calibration multiplier, and the
// calibration itself. Every figure is computed inside the model (lib/model.ts) by refitting the
// ensemble without each launched protocol in turn and predicting the one left out.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LaunchValueModel, parseSnapshot } from '../lib/model.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const snapshotFile = process.argv[2] ?? join(here, '..', '..', 'kit-radar', 'token-radar-01-kit', 'input', 'snapshot.json');

const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const model = LaunchValueModel.train(snapshot);
const bt = model.backtest;

process.stdout.write(
  'snapshot as of ' + snapshot.as_of + ': ' + snapshot.protocols.length + ' protocols\n' +
    'launched universe (TVL and market cap both recorded): ' + bt.n + '\n' +
    'leave-one-out Spearman (predicted vs actual market cap): ' + bt.spearman.toFixed(3) + '\n' +
    'median predicted/actual before calibration: ' + bt.medianRatioBefore.toFixed(3) + '\n' +
    'calibration multiplier (median actual/predicted): x' + model.calibration.toFixed(4) + '\n' +
    'median predicted/actual after calibration: ' + bt.medianRatioAfter.toFixed(3) + '\n',
);
