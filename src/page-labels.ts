/**
 * The payout table against what the PRODUCTION game page shows — PLINKO-13 (paytable provenance).
 *
 * evidence/liqd-plinko-page-reads-2026-10-20.json is a saved read of two public liqd.com pages, made logged out
 * on 20 October 2026 (its own `method` field says how): the text of liqd.com/originals/plinko and, under
 * `boardLabels.labels`, the text of the bucket strip for every risk button and every Rows setting — the
 * multipliers the page shows a player for each board. The file is pinned here by SHA-256.
 *
 * `checkTableAgainstPageRead` holds EVERY cell of the pinned plinkoConfig.json to that read:
 *
 *   • the 27 standard boards ("Low/8" … "High/16"): one label per bucket, slot 0 first. A label is a decimal
 *     number and must equal the cell exactly — except the label `1k`, which the strip shows on four buckets
 *     (High/16 slots 0 and 16, WTF slots 0 and 13). `1k` is read as 1000 on the strength of the page's own
 *     sentence, which must be present in the saved text: "1,000x (High at 16 rows, WTF at 13 rows)".
 *   • WTF ("WTF/13"): the strip carries text on the four outer buckets only (`1k 235 235 1k`); the ten middle
 *     buckets show an icon. Their value comes from the page's own sentences, each of which must be present:
 *     "the ten middle buckets pay nothing", "The two buckets next to the edges pay 235x, the two outermost pay
 *     1,000x". The four labels are held to slots 0, 1, 12 and 13, and the ten middle cells to 0.
 *
 * What this is: the table equals what liqd.com displayed on 20 October 2026, cell for cell. What it is not: a
 * read of a machine-readable table, or of the page on the capture days (7, 9 and 10 November 2026). Step 7 is the
 * check on the capture days, and it covers the cells that were paid.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import type { PlinkoConfigData } from './types';
import { payoutTable, allConfigs, isWtf } from './config';

export const PAGE_READ_FILE = 'evidence/liqd-plinko-page-reads-2026-10-20.json';
export const PAGE_READ_SHA256 = '769754a5cb5ddd1156759940ca6b000982b5872384103a66d997fad4b093aab0';

const RISK_NAME: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };
const STATEMENT_1K = '1,000x (High at 16 rows, WTF at 13 rows)';
const STATEMENT_WTF_ZERO = 'the ten middle buckets pay nothing';
const STATEMENT_WTF_PAYING = 'The two buckets next to the edges pay 235x, the two outermost pay 1,000x';

export interface PageTableCheck {
  ok: boolean;
  fileSha256: string | null;
  boards: number;
  /** Cells of the pinned table compared, and how each was read from the page. */
  cells: number;
  cellsByNumericLabel: number;
  cellsBy1kLabel: number;
  cellsByPageStatement: number;
  mismatches: number;
  problems: string[];
}

export function checkTableAgainstPageRead(cfg: PlinkoConfigData, root: string): PageTableCheck {
  const out: PageTableCheck = {
    ok: false, fileSha256: null, boards: 0, cells: 0,
    cellsByNumericLabel: 0, cellsBy1kLabel: 0, cellsByPageStatement: 0, mismatches: 0, problems: [],
  };
  const p = path.join(root, PAGE_READ_FILE);
  if (!existsSync(p)) { out.problems.push(`${PAGE_READ_FILE} is missing`); return out; }
  const raw = readFileSync(p);
  out.fileSha256 = createHash('sha256').update(raw).digest('hex');
  if (out.fileSha256 !== PAGE_READ_SHA256) { out.problems.push(`${PAGE_READ_FILE} hashes to ${out.fileSha256}, pinned ${PAGE_READ_SHA256}`); return out; }
  const doc = JSON.parse(raw.toString('utf8')) as {
    plinkoPage?: { url?: string; text?: string };
    boardLabels?: { url?: string; labels?: Record<string, string[]> };
  };
  const text = doc.plinkoPage?.text ?? '';
  const labels = doc.boardLabels?.labels ?? {};
  if (doc.plinkoPage?.url !== 'https://liqd.com/originals/plinko' || doc.boardLabels?.url !== 'https://liqd.com/originals/plinko') {
    out.problems.push('the saved read is not of https://liqd.com/originals/plinko');
  }
  const has1k = text.includes(STATEMENT_1K);
  const hasZero = text.includes(STATEMENT_WTF_ZERO);
  const hasPaying = text.includes(STATEMENT_WTF_PAYING);
  const miss = (what: string) => { out.mismatches++; if (out.problems.length < 6) out.problems.push(what); };

  for (const c of allConfigs(cfg)) {
    const table = payoutTable(cfg, c.rows, c.riskLevel);
    out.boards++;
    if (isWtf(c.riskLevel)) {
      const strip = labels[`WTF/${c.rows}`];
      const last = table.length - 1;
      const labelled = [0, 1, last - 1, last];
      if (!strip || strip.length !== labelled.length) { miss(`WTF/${c.rows}: ${strip ? strip.length : 'no'} strip label(s), 4 expected`); continue; }
      table.forEach((cell, slot) => {
        out.cells++;
        const li = labelled.indexOf(slot);
        if (li >= 0) {
          const lab = strip[li];
          if (lab === '1k') {
            out.cellsBy1kLabel++;
            if (!has1k || !hasPaying || cell !== 1000) miss(`WTF/${c.rows} slot ${slot}: label 1k, cell ${cell}`);
          } else {
            out.cellsByNumericLabel++;
            if (!/^\d+(\.\d+)?$/.test(lab) || Number(lab) !== cell || !hasPaying) miss(`WTF/${c.rows} slot ${slot}: label ${lab}, cell ${cell}`);
          }
        } else {
          out.cellsByPageStatement++;
          if (!hasZero || cell !== 0) miss(`WTF/${c.rows} slot ${slot}: the page says the middle ten pay nothing, cell ${cell}`);
        }
      });
      continue;
    }
    const key = `${RISK_NAME[c.riskLevel]}/${c.rows}`;
    const strip = labels[key];
    if (!strip || strip.length !== table.length) { miss(`${key}: ${strip ? strip.length : 'no'} strip label(s), ${table.length} cells`); continue; }
    table.forEach((cell, slot) => {
      out.cells++;
      const lab = strip[slot];
      if (lab === '1k') {
        out.cellsBy1kLabel++;
        if (!has1k || cell !== 1000) miss(`${key} slot ${slot}: label 1k, cell ${cell}`);
      } else {
        out.cellsByNumericLabel++;
        if (!/^\d+(\.\d+)?$/.test(lab) || Number(lab) !== cell) miss(`${key} slot ${slot}: label ${lab}, cell ${cell}`);
      }
    });
  }
  // No board on the page may be left unread: the label set is exactly the table's boards.
  const expectedKeys = allConfigs(cfg).map(c => isWtf(c.riskLevel) ? `WTF/${c.rows}` : `${RISK_NAME[c.riskLevel]}/${c.rows}`).sort();
  const pageKeys = Object.keys(labels).sort();
  if (expectedKeys.join('|') !== pageKeys.join('|')) miss(`the page read holds ${pageKeys.length} board(s), the table ${expectedKeys.length}`);
  out.ok = out.problems.length === 0 && out.mismatches === 0 && out.cells > 0;
  return out;
}
