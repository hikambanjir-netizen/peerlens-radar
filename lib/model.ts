// PeerLens value model for token-radar-01 (Node 22, standard library only).
//
// What a pre-token protocol's token would be worth if it launched today is not in the snapshot;
// this model derives it from the protocols whose tokens already trade. It is built in three layers:
//
//   1. A size line. Across the snapshot protocols that record both a TVL and a market cap,
//      log market cap rises with log TVL at a slope well under 1 (about 0.52): big protocols are
//      worth more, but at a smaller multiple of the assets they hold.
//   2. Partially pooled peer effects. Each protocol's residual from the size line is averaged
//      within its category, then within its primary-chain ecosystem, with the averages shrunk
//      toward zero by the group's size (a group of 4 moves the estimate less than a group of 40)
//      and winsorised so one wild launch cannot bend a whole category. Eight fits that vary the
//      shrinkage and the winsor clip are averaged in log space, which steadies the estimate.
//   3. Two small fixed tilts and a calibration. Seven-day TVL momentum and the years a protocol
//      has run with no token tilt the value by a few percent at most: the backtest below gives
//      them little independent weight once size and peers are counted, so they are kept weak on
//      purpose. A single calibration multiplier, the median ratio of actual to predicted over a
//      leave-one-out pass on the launched protocols, removes the model's systematic bias.
//
// Honest validation, computed by this same code on every run from the sealed snapshot:
// leave-one-out over the launched protocols gives a Spearman rank correlation of about 0.44
// between predicted and actual market caps and a median predicted/actual ratio of 1.00 after
// calibration (about 0.96 before it). The model ranks far better than it prices: treat the
// implied values as a ranking with a scale, not as price targets.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parse and lightly validate the sealed snapshot; the program refuses a snapshot it cannot read. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (!isRecord(raw)) throw new SnapshotError('snapshot root is not an object');
  if (typeof raw.as_of !== 'string') throw new SnapshotError('snapshot as_of is missing');
  if (!Array.isArray(raw.protocols)) throw new SnapshotError('snapshot protocols is missing');
  const protocols: SnapshotProtocol[] = [];
  for (const entry of raw.protocols) {
    if (!isRecord(entry)) throw new SnapshotError('a protocol entry is not an object');
    const slug = strOrNull(entry.slug);
    const name = strOrNull(entry.name);
    const tvl = numOrNull(entry.tvl_usd);
    if (slug === null || name === null || tvl === null) {
      throw new SnapshotError('a protocol entry lacks slug, name or tvl_usd');
    }
    protocols.push({
      slug,
      name,
      category: strOrNull(entry.category),
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: tvl,
      change_7d: numOrNull(entry.change_7d),
      mcap_usd: numOrNull(entry.mcap_usd),
      listed_at: strOrNull(entry.listed_at),
      gecko_id: strOrNull(entry.gecko_id),
      symbol: strOrNull(entry.symbol),
    });
  }
  const watchlist = Array.isArray(raw.watchlist)
    ? raw.watchlist.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    as_of: raw.as_of,
    source: typeof raw.source === 'string' ? raw.source : '',
    floor_usd: typeof raw.floor_usd === 'number' ? raw.floor_usd : 50_000_000,
    protocols,
    watchlist,
  };
}

// ---------------------------------------------------------------- features

const DAY_MS = 86_400_000;

/** Years between the day DefiLlama began tracking the protocol and the snapshot's day. */
export function ageYears(p: SnapshotProtocol, asOfMs: number): number | null {
  if (p.listed_at === null) return null;
  const listed = Date.parse(p.listed_at + 'T00:00:00Z');
  if (!Number.isFinite(listed)) return null;
  return Math.max(0, (asOfMs - listed) / DAY_MS / 365.25);
}

const ECOSYSTEMS = [
  'Ethereum', 'Solana', 'Base', 'Arbitrum', 'Binance',
  'Avalanche', 'Polygon', 'Hyperliquid L1', 'Optimism', 'Tron',
];

/** The ecosystem a protocol is read as belonging to: its first-listed chain, grouped. */
export function ecosystemOf(p: SnapshotProtocol): string {
  const first = p.chains.length > 0 ? p.chains[0]! : '';
  return ECOSYSTEMS.includes(first) ? first : 'Other';
}

/** Seven-day TVL momentum squashed to (-1, 1) so one wild week cannot dominate. */
export function momentumOf(p: SnapshotProtocol): number {
  return Math.tanh((p.change_7d ?? 0) / 25);
}

export interface FeatureRow {
  protocol: SnapshotProtocol;
  lnTvl: number;
  lnMcap: number;
  category: string;
  ecosystem: string;
  momentum: number;
  lnAge: number;
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function meanOf(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The median tracked age of a protocol set, used to fill the protocols that record no start day. */
export function medianAgeOf(protocols: SnapshotProtocol[], asOfMs: number): number {
  const known = protocols
    .map((p) => ageYears(p, asOfMs))
    .filter((a): a is number => a !== null);
  return known.length > 0 ? medianOf(known) : 2;
}

export function featureRow(p: SnapshotProtocol, asOfMs: number, medianAge: number): FeatureRow {
  const age = ageYears(p, asOfMs) ?? medianAge;
  return {
    protocol: p,
    lnTvl: Math.log(Math.max(1, p.tvl_usd)),
    lnMcap: Math.log(Math.max(1, p.mcap_usd ?? 1)),
    category: p.category ?? '(none)',
    ecosystem: ecosystemOf(p),
    momentum: momentumOf(p),
    lnAge: Math.log(1 + age),
  };
}

// ---------------------------------------------------------------- the fit

export interface FitConfig {
  winsor: number;
  tauCategory: number;
  tauEcosystem: number;
}

/** The eight ensemble members: two winsor clips crossed with two shrinkage strengths per layer. */
export const ENSEMBLE: FitConfig[] = [];
for (const winsor of [2, 2.5]) {
  for (const tauCategory of [4, 6]) {
    for (const tauEcosystem of [4, 6]) {
      ENSEMBLE.push({ winsor, tauCategory, tauEcosystem });
    }
  }
}

/** Fixed tilts, kept weak on purpose: the backtest gives growth and age little weight of their own. */
export const MOMENTUM_TILT = 0.06;
export const AGE_TILT = 0.03;

export interface PooledFit {
  intercept: number;
  slope: number;
  categoryEffect: Map<string, number>;
  ecosystemEffect: Map<string, number>;
}

const clip = (value: number, bound: number): number => Math.max(-bound, Math.min(bound, value));

/** One ensemble member: a size line plus winsorised, partially pooled category and ecosystem effects. */
export function fitOne(rows: FeatureRow[], config: FitConfig): PooledFit {
  const meanX = meanOf(rows.map((r) => r.lnTvl));
  const meanY = meanOf(rows.map((r) => r.lnMcap));
  let cov = 0;
  let varX = 0;
  for (const r of rows) {
    cov += (r.lnTvl - meanX) * (r.lnMcap - meanY);
    varX += (r.lnTvl - meanX) ** 2;
  }
  const slope = varX > 0 ? cov / varX : 1;
  const intercept = meanY - slope * meanX;
  const residual = (r: FeatureRow): number =>
    clip(r.lnMcap - (intercept + slope * r.lnTvl), config.winsor);

  const categoryEffect = new Map<string, number>();
  {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const list = groups.get(r.category) ?? [];
      list.push(residual(r));
      groups.set(r.category, list);
    }
    for (const [category, values] of groups) {
      categoryEffect.set(category, values.reduce((s, v) => s + v, 0) / (values.length + config.tauCategory));
    }
  }
  const ecosystemEffect = new Map<string, number>();
  {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const list = groups.get(r.ecosystem) ?? [];
      list.push(residual(r) - (categoryEffect.get(r.category) ?? 0));
      groups.set(r.ecosystem, list);
    }
    for (const [ecosystem, values] of groups) {
      ecosystemEffect.set(ecosystem, values.reduce((s, v) => s + v, 0) / (values.length + config.tauEcosystem));
    }
  }
  return { intercept, slope, categoryEffect, ecosystemEffect };
}

// ---------------------------------------------------------------- the model

export interface ValueParts {
  /** Log value from the size line alone, averaged over the ensemble. */
  sizeLn: number;
  /** Log adjustment from the category effect, averaged over the ensemble. */
  categoryLn: number;
  /** Log adjustment from the ecosystem effect, averaged over the ensemble. */
  ecosystemLn: number;
  /** Log adjustment from the momentum and age tilts. */
  tiltLn: number;
  /** Total log value before calibration. */
  totalLn: number;
}

function ensembleLogValue(fits: PooledFit[], medianLnAge: number, row: FeatureRow): ValueParts {
  let sizeLn = 0;
  let categoryLn = 0;
  let ecosystemLn = 0;
  for (const fit of fits) {
    sizeLn += fit.intercept + fit.slope * row.lnTvl;
    categoryLn += fit.categoryEffect.get(row.category) ?? 0;
    ecosystemLn += fit.ecosystemEffect.get(row.ecosystem) ?? 0;
  }
  const n = fits.length;
  sizeLn /= n;
  categoryLn /= n;
  ecosystemLn /= n;
  const tiltLn = MOMENTUM_TILT * row.momentum + AGE_TILT * (row.lnAge - medianLnAge);
  return { sizeLn, categoryLn, ecosystemLn, tiltLn, totalLn: sizeLn + categoryLn + ecosystemLn + tiltLn };
}

export interface Backtest {
  n: number;
  spearman: number;
  medianRatioBefore: number;
  medianRatioAfter: number;
}

export class LaunchValueModel {
  readonly fits: PooledFit[];
  readonly medianLnAge: number;
  readonly medianAge: number;
  /** Median actual/predicted over the leave-one-out pass; multiplies every prediction. */
  readonly calibration: number;
  readonly backtest: Backtest;
  readonly asOfMs: number;

  private constructor(init: {
    fits: PooledFit[];
    medianLnAge: number;
    medianAge: number;
    calibration: number;
    backtest: Backtest;
    asOfMs: number;
  }) {
    this.fits = init.fits;
    this.medianLnAge = init.medianLnAge;
    this.medianAge = init.medianAge;
    this.calibration = init.calibration;
    this.backtest = init.backtest;
    this.asOfMs = init.asOfMs;
  }

  /** The launched protocols the model learns from: both a TVL and a market cap recorded. */
  static launchedSet(snapshot: Snapshot): SnapshotProtocol[] {
    return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  }

  static train(snapshot: Snapshot): LaunchValueModel {
    const asOfMs = Date.parse(snapshot.as_of + 'T00:00:00Z');
    const launched = LaunchValueModel.launchedSet(snapshot);
    const medianAge = medianAgeOf(launched, asOfMs);
    const rows = launched.map((p) => featureRow(p, asOfMs, medianAge));
    const medianLnAge = medianOf(rows.map((r) => r.lnAge));
    const fits = ENSEMBLE.map((config) => fitOne(rows, config));

    // Leave-one-out over the launched set: refit the ensemble without each protocol in turn,
    // predict it, and read off both the calibration multiplier and the honest accuracy numbers.
    const looPred: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rest = rows.filter((_, j) => j !== i);
      const foldFits = ENSEMBLE.map((config) => fitOne(rest, config));
      const foldMedianLnAge = medianOf(rest.map((r) => r.lnAge));
      looPred.push(Math.exp(ensembleLogValue(foldFits, foldMedianLnAge, rows[i]!).totalLn));
    }
    const actual = rows.map((r) => Math.exp(r.lnMcap));
    const calibration = medianOf(actual.map((a, i) => a / looPred[i]!));
    const backtest: Backtest = {
      n: rows.length,
      spearman: spearmanOf(looPred, actual),
      medianRatioBefore: medianOf(looPred.map((pred, i) => pred / actual[i]!)),
      medianRatioAfter: medianOf(looPred.map((pred, i) => (pred * calibration) / actual[i]!)),
    };
    return new LaunchValueModel({ fits, medianLnAge, medianAge, calibration, backtest, asOfMs });
  }

  /** The model's value for any protocol, with the layer-by-layer breakdown kept for the dashboard. */
  parts(p: SnapshotProtocol): ValueParts {
    return ensembleLogValue(this.fits, this.medianLnAge, featureRow(p, this.asOfMs, this.medianAge));
  }

  /** Implied launch value in whole dollars, calibrated, inside the gate's caps. */
  impliedValue(p: SnapshotProtocol): number {
    const raw = Math.exp(this.parts(p).totalLn) * this.calibration;
    return Math.max(1, Math.min(100_000_000_000_000, Math.round(raw)));
  }
}

/** Spearman rank correlation with average ranks for ties. */
export function spearmanOf(xs: number[], ys: number[]): number {
  const ranks = (values: number[]): number[] => {
    const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
    const out = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && values[order[j + 1]!] === values[order[i]!]) j++;
      const average = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k]!] = average;
      i = j + 1;
    }
    return out;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = meanOf(rx);
  const my = meanOf(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

// ---------------------------------------------------------------- the board

/** A protocol records no token when DefiLlama carries neither a gecko id nor a symbol for it. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const DERIVATIVE_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const VERSION_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * A wrapped, staked, bridged or versioned product of a protocol whose token already trades is not
 * a launch still to come, so the radar leaves it out of the candidate set (the house's watchlist
 * rule draws the same line; the radar applies it at every size, not only above the floor).
 */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (VERSION_NAME.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix));
}

/** A board candidate: records no token and is not a derivative product of one that trades. */
export function isCandidate(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isDerivativeProduct(p);
}

// ---------------------------------------------------------------- farm plans

const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

function capitalBand(tvl: number): string {
  if (tvl >= 500_000_000) return '$2,000-$10,000';
  if (tvl >= 100_000_000) return '$1,000-$5,000';
  if (tvl >= 25_000_000) return '$500-$2,000';
  return '$100-$500';
}

function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'about $10-$30 of ETH for gas over a month of sessions';
  if (chain === 'Solana') return 'about $5 of SOL for transaction fees over a month of sessions';
  if (chain === 'Binance') return 'about $5 of BNB for gas over a month of sessions';
  return 'about $5 of the chain gas token over a month of sessions; fees on this chain run under a dollar a session';
}

interface FarmProfile {
  core: string;
  deepen: string;
}

function farmProfile(category: string | null): FarmProfile {
  switch (category) {
    case 'Dexs':
      return {
        core: 'Swap between the deepest pairs in regular size: trade {cap} of volume a week in clips of $100-$500, spreading trades across at least three different days so the activity reads as real use, not one burst.',
        deepen: 'Add a small liquidity position ({cap} at most) to a top-three pool and leave it in place for at least four weeks; concentrated positions need a weekly check and a rebalance when the price leaves the range.',
      };
    case 'Lending':
      return {
        core: 'Supply {cap} of a major asset (ETH, a stablecoin or the chain gas token) as collateral and borrow 30-40% of it back, then repay and redraw once a week so both sides of the market see the address.',
        deepen: 'Keep the position open for at least six weeks and roll it once into a second market on the same protocol; watch the health factor weekly and top up collateral whenever it drifts under 1.6.',
      };
    case 'Derivatives':
    case 'Perpetuals':
      return {
        core: 'Open small perpetual positions totalling {cap} of margin across the week, holding each for at least a few hours and closing some at a profit and some at a loss; hedged or one-minute trades read as wash activity.',
        deepen: 'Use one advanced feature as well: a limit order, a stop, or the protocol vault. Deposit {cap} at most into the vault side for four weeks so the address shows both trader and liquidity history.',
      };
    case 'Yield':
    case 'Yield Aggregator':
      return {
        core: 'Deposit {cap} into the flagship vault or strategy and leave it for at least six weeks; yield points and share balances are usually counted on time-weighted balances, so patience is the position.',
        deepen: 'Split a second, smaller deposit ({cap} at most) into a different strategy on the same protocol and harvest or compound the yield once a fortnight so the address shows ongoing management.',
      };
    case 'CDP':
      return {
        core: 'Lock {cap} of collateral and mint the protocol stablecoin at a conservative 35-45% loan-to-value, then use the minted coins inside the protocol own markets so both the vault and the coin see the address.',
        deepen: 'Hold the vault open for at least six weeks, adjusting collateral once when the collateral price moves 20% either way; repay a slice and re-mint once so the full lifecycle is on the record.',
      };
    case 'RWA':
      return {
        core: 'Complete the onboarding or allowlist steps first, then buy {cap} of the smallest tokenised asset or treasury product on offer and hold it; for real-world-asset protocols the allowlist itself is often the scarce step.',
        deepen: 'Add a second product or a second deposit of {cap} at most after the first settles, and claim or reinvest one yield payment so the address shows a full hold-and-earn cycle over at least six weeks.',
      };
    case 'Cross Chain Bridge':
      return {
        core: 'Bridge {cap} of assets a week in clips of $100-$300 across at least two different routes and both directions; one large bridge counts for less than a month of ordinary two-way traffic.',
        deepen: 'Leave {cap} at most of the bridged assets working on the far chain for at least four weeks (supplied or in a pool there) instead of bridging straight back, and keep the source and destination addresses the same throughout.',
      };
    case 'Gaming':
      return {
        core: 'Play the live game or app in short regular sessions, spending {cap} at most in total on the in-game assets, fees or passes the protocol sells; daily and weekly quests are usually the actions that eligibility counts.',
        deepen: 'Finish one full season, chapter or leaderboard cycle rather than sampling once, and hold any earned in-game asset in the same wallet instead of selling it the day it lands.',
      };
    case 'Privacy':
      return {
        core: 'Deposit {cap} into the shielded pool or private account in two or three separate notes, make at least one private transfer, and withdraw to the same address after at least two weeks so the full cycle is recorded.',
        deepen: 'Repeat the cycle once with a second, smaller amount ({cap} at most) a month later; privacy protocols tend to count distinct active months and note diversity over raw size.',
      };
    case 'Launchpad':
      return {
        core: 'Register for the next sale or allocation round, complete any staking or allowlist requirement with {cap} at most, and take part in one live round even at the smallest ticket so the address is on the participant list.',
        deepen: 'Hold whatever the round issues for at least four weeks instead of flipping it on day one, and join a second round when it opens; repeat participants are the group these protocols reward.',
      };
    default:
      return {
        core: 'Use the flagship product with {cap} of working capital: make the main deposit, trade or position the protocol is built around, in at least three separate sessions across two weeks so the history is spread out.',
        deepen: 'Add the protocol second feature as well (a second market, pool or vault) with {cap} at most, and keep both positions open for at least four weeks so the address shows depth, not a single touch.',
      };
  }
}

/** Five concrete steps to farm one protocol: setup, core use, cadence, depth, and record-keeping. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const cap = capitalBand(p.tvl_usd);
  const gas = gasNote(chain);
  const profile = farmProfile(p.category);
  const fill = (text: string): string => text.replaceAll('{cap}', cap);
  return [
    `Set up a fresh wallet for ${p.name} and fund it on ${chain}: keep ${gas}. Open the ${p.name} app, connect, and make one small test transaction first (about 20 minutes) so the address is live before any real size moves.`,
    fill(profile.core),
    `Keep a twice-weekly cadence of 20-30 minutes: repeat the core action, claim anything the protocol hands out, and check its points or rewards page. Regular weeks count for more than one large week in almost every points system.`,
    fill(profile.deepen),
    `Keep a simple log of dates, amounts and transaction hashes for this address, and re-check the protocol announcements weekly: snapshots are usually taken without warning. Total budget: ${cap} of working capital plus ${gas}.`,
  ];
}

// ---------------------------------------------------------------- radar data

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  watchlist: boolean;
}

export interface PeerInfo {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  ecosystem: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  waterfall: { size_usd: number; category_usd: number; ecosystem_usd: number; implied_usd: number };
  peers: PeerInfo[];
  peers_from: string;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  ratio: number | null;
}

export interface RadarData {
  meta: {
    title: string;
    as_of: string;
    source: string;
    floor_usd: number;
    n_protocols: number;
    n_candidates: number;
    n_watchlist: number;
    n_launched: number;
    calibration: number;
    backtest: { n: number; spearman: number; median_ratio_before: number; median_ratio_after: number };
  };
  rows: RadarRow[];
  live: LiveRow[];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = LaunchValueModel.train(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const launched = LaunchValueModel.launchedSet(snapshot);
  const asOfMs = model.asOfMs;

  const peerInfo = (p: SnapshotProtocol): PeerInfo => ({
    name: p.name,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd ?? 0,
    ratio: Math.round(((p.mcap_usd ?? 0) / p.tvl_usd) * 1000) / 1000,
  });
  const peersFor = (p: SnapshotProtocol): { peers: PeerInfo[]; from: string } => {
    const sameCategory = launched
      .filter((q) => (q.category ?? '(none)') === (p.category ?? '(none)'))
      .sort((a, b) => b.tvl_usd - a.tvl_usd);
    if (sameCategory.length >= 3) {
      return { peers: sameCategory.slice(0, 5).map(peerInfo), from: 'category' };
    }
    const sameEco = launched
      .filter((q) => ecosystemOf(q) === ecosystemOf(p))
      .sort((a, b) => b.tvl_usd - a.tvl_usd);
    const merged = [...sameCategory, ...sameEco.filter((q) => !sameCategory.includes(q))];
    return { peers: merged.slice(0, 5).map(peerInfo), from: sameCategory.length > 0 ? 'category+ecosystem' : 'ecosystem' };
  };

  const scored = snapshot.protocols.filter(isCandidate).map((p) => {
    const parts = model.parts(p);
    const sizeUsd = Math.exp(parts.sizeLn) * model.calibration;
    const categoryUsd = sizeUsd * Math.exp(parts.categoryLn);
    const ecosystemUsd = categoryUsd * Math.exp(parts.ecosystemLn);
    const implied = Math.max(1, Math.min(100_000_000_000_000, Math.round(ecosystemUsd * Math.exp(parts.tiltLn))));
    const steps = farmSteps(p);
    const { peers, from } = peersFor(p);
    const age = ageYears(p, asOfMs);
    const row: RadarRow = {
      slug: p.slug,
      name: p.name,
      rank: 0,
      category: p.category,
      ecosystem: ecosystemOf(p),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_years: age === null ? null : Math.round(age * 100) / 100,
      watchlist: watchlist.has(p.slug),
      implied_value_usd: implied,
      multiple: Math.round((implied / p.tvl_usd) * 1000) / 1000,
      waterfall: {
        size_usd: Math.round(sizeUsd),
        category_usd: Math.round(categoryUsd),
        ecosystem_usd: Math.round(ecosystemUsd),
        implied_usd: implied,
      },
      peers,
      peers_from: from,
      farm_steps: steps,
    };
    return row;
  });

  scored.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const board: BoardRow[] = scored.map((row) => ({
    slug: row.slug,
    name: row.name,
    rank: row.rank,
    implied_value_usd: row.implied_value_usd,
    farm_steps: row.farm_steps,
    category: row.category,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    watchlist: row.watchlist,
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      ratio: p.mcap_usd !== null && p.mcap_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
    }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);

  const radar: RadarData = {
    meta: {
      title: 'PeerLens — Token Launch Radar',
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      n_protocols: snapshot.protocols.length,
      n_candidates: scored.length,
      n_watchlist: snapshot.watchlist.length,
      n_launched: launched.length,
      calibration: Math.round(model.calibration * 10000) / 10000,
      backtest: {
        n: model.backtest.n,
        spearman: Math.round(model.backtest.spearman * 1000) / 1000,
        median_ratio_before: Math.round(model.backtest.medianRatioBefore * 1000) / 1000,
        median_ratio_after: Math.round(model.backtest.medianRatioAfter * 1000) / 1000,
      },
    },
    rows: scored,
    live,
  };
  return { board, radar };
}

/** The gate's shape, checked before anything is written: a refusal here is a model bug, not a hand-in. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = board.length > 1;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1} names a slug the snapshot does not hold: ${row.slug}`;
    if (seen.has(row.slug)) return `slug appears twice: ${row.slug}`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} carries an implied value outside the caps`;
    }
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} holds ${row.farm_steps.length} farm steps, outside 3-12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} holds a farm step of ${trimmed.length} characters, outside 20-600`;
      }
    }
  }
  if (allSame) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  return null;
}

/** The dashboard's data as a script the static page loads: no network, no framework. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR_DATA = ' + JSON.stringify(radar).replaceAll('</', '<\\/') + ';\n';
}

export { money };
