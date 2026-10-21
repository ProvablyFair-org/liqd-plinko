// Types mirror the exact capture schema in data/plinko-master-10100bets.json
// (liqd-plinko-capture-v1). Field names match the dataset verbatim — do not rename.

export interface Seed {
  epoch: number;
  phase: string;                    // A | B | C | D | E
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
  epoch: number;
  phase: string;                    // A | B | C | D | E
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
  betAmount: string;                // decimal string, full precision
  winningAmount: string;
  multiplier: number;
  coefficient: number;
  result: string;                   // won | lost
  currentGameSettings: string;      // JSON string: minBet/maxBet/maxProfit/houseEdge...
  createdAt: string;
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

export interface DatasetMeta {
  audit: string;
  platform: string;
  gameId: string;
  schema: string;
  houseEdge: number;
  currency: string;
  epochSize: number;
  plannedTotal: number;
  phases: Record<string, { bets: number; amount: number; mode?: string; riskLevel?: number; rows?: number }>;
  startedAt: string;
  finishedAt?: string;
  progress?: Record<string, unknown>;
  preCapture?: PreCapture;
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
