// PeerLens — Token Launch Radar (token-radar-01 entry, Node 22, standard library only).
//
// The program reads the sealed DefiLlama snapshot from /input/snapshot.json (or --input <file|dir>),
// trains the launch-value model in lib/model.ts on the protocols whose tokens already trade, ranks
// every pre-token candidate by implied launch value, and writes the hand-in to /output:
//   board.json    the ranked board the gate reads
//   data.js       the same board, with the model's working shown, for the dashboard
//   dashboard/    the static page (board, detail view, filters, methodology)
//   screenshots/  the three views of the page
//   dossier.json  the summary the judge reads, written by vendor/makefun-board.ts
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier text cap the scorer rebuilds with; the screenshot caps the gate enforces. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf('--' + name);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith('--' + name + '='));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write('peerlens: no snapshot at ' + inputFile + ': pass --input <snapshot.json|directory> or mount the sealed /input\n');
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write('peerlens: the model wrote a board the gate refuses: ' + issue + '\n');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write('peerlens: screenshots/ holds ' + shots.length + ' image(s): hand in 3, the board, a detail view and a filtered view\n');
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write('peerlens: screenshots/' + name + ': a name is letters, digits and . _ -, 1 to 128 characters\n');
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

// A short run summary on stdout: what went in, how the model scored itself, and the head of the board.
const meta = radar.meta;
const top = board.slice(0, 5).map((row) => '#' + row.rank + ' ' + row.name + ' ($' + row.implied_value_usd.toLocaleString('en-US') + ')').join(', ');
process.stdout.write(
  'peerlens: ' + snapshot.protocols.length + ' protocols, ' + meta.n_launched + ' launched peers, ' +
    meta.n_candidates + ' pre-token candidates ranked, all ' + meta.n_watchlist + ' watchlist protocols covered\n' +
    'peerlens: leave-one-out on the launched set: Spearman ' + meta.backtest.spearman.toFixed(3) +
    ', median predicted/actual ' + meta.backtest.median_ratio_before.toFixed(3) + ' before calibration, ' +
    meta.backtest.median_ratio_after.toFixed(3) + ' after (x' + meta.calibration.toFixed(3) + ')\n' +
    'peerlens: top of the board: ' + top + '\n' +
    'peerlens: wrote board.json, data.js, dashboard/ (' + dashboardFiles.length + ' files), screenshots/ (' + shots.length + ' images) and dossier.json to ' + out + '\n',
);
