// Types mirror the scored dataset, data/plinko-prod-9750bets.json (three liqd-plinko-prod-capture-v1 exports
// converted into one { meta, seeds, bets } file). Field names match the dataset verbatim — do not rename.

export interface Seed {
  epoch: number;                    // 0..51 across the three captures, in the order played
  phase: string;                    // plan phase letter: A | B | C | D | E
  phaseId: string;                  // plan entry: the letter, or 'A+W' (Phase A's drops on the WTF board)
  capture: number;                  // 1-based index into meta.captures
  captureEpoch: number;             // the epoch number inside its own capture file
  seedTag: string;                  // 'player' (a Phase D player-set client seed) | 'audit' (the runner's per-epoch seed)
  plannedBets: number;              // the runner's planned length of the epoch
  stake: string;                    // the runner's planned stake of the epoch
  at: string;
  clientSeed: string;
  hashedServerSeed: string;         // SHA-256(utf8(serverSeed)) commitment
  nextHashedServerSeed: string;     // pre-commitment for the next epoch (chain link)
  serverSeed: string | null;        // revealed on rotation
  nonceStart: number;
  nonceEnd: number | null;
  commitVerified: boolean | null;   // capture-side flag (re-derived independently in verify)
  chainLinkOk: boolean | null;      // capture-side flag (re-derived independently in verify)
}

export interface Bet {
  at: string;
  capture: number;                  // 1-based index into meta.captures
  epoch: number;
  phase: string;                    // plan phase letter: A | B | C | D | E
  phaseId: string;                  // plan entry: the letter, or 'A+W'
  id: string;
  gameId: string;                   // fast-games-5
  numberOfRows: number;             // 8..16 (standard) or 13 (WTF)
  riskLevel: number;                // 1=low 2=med 3=high 4=WTF
  dropDetails: string;              // per-row bit string, '0'=left '1'=right
  winningSlot: number;              // = count of '1' bits
  nonce: number;
  clientSeed: string;
  serverSeedId: string;
  hashedServerSeed: string;
  betAmount: string;                // the served stake, 8-dp decimal string
  winningAmount: string;            // the served credit: 8-dp decimal string, or "0" on a WTF drop that pays nothing
  multiplier: number;
  result: string;                   // won | lost
  // Capture-side self-verification fields (informational; verify re-derives independently)
  localPath?: string | null;
  localSlot?: number | null;
  verified?: boolean | null;
}

export interface PreCapture {
  at: string;
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
  nextHashedServerSeed: string;
  revealedServerSeed: string | null;
  commitVerified: boolean | null;
}

/** One capture file (one run of the runner) and its own pre-capture anchor. */
export interface CaptureRecord {
  capture: number;
  file: string;
  sha256: string;
  bytes: number;
  lines: number;
  runner: string;
  firstEpoch: number;
  lastEpoch: number;
  epochs: number;
  bets: number;
  startedAt: string;
  firstRoundAt: string;
  lastRoundAt: string;
  finishedAt: string | null;
  status: string;
  preCapture: PreCapture;
  [k: string]: unknown;
}

export interface DatasetMeta {
  audit: string;
  platform: string;
  gameId: string;
  schema: string;
  houseEdge: number;
  currency: string;
  plannedTotal: number;
  phases: Record<string, { bets: number; stake: string; amount: number; epochs: number; epochSizes: number[]; ids: Record<string, number> }>;
  startedAt: string;
  finishedAt?: string;
  progress?: Record<string, unknown>;
  captures: CaptureRecord[];
  /** Converter provenance: field-by-field origin. */
  conversion?: Record<string, unknown>;
}

export interface Dataset {
  meta: DatasetMeta;
  seeds: Seed[];
  bets: Bet[];
}

// ── Game config (plinkoConfig.json) ────────────────────────────────────────────
// payout_tables[rows] = [ low[], medium[], high[] ]  (risk 1,2,3 → index 0,1,2)
export interface PlinkoConfigData {
  platform: string;
  gameId: string;
  houseEdge: number;
  rows: { min: number; max: number };
  riskLevels: Record<string, string>;
  wtf_mode: { riskLevel: number; rows: number; odds: number[]; note?: string };
  payout_tables: Record<string, number[][]>;
}
