/**
 * The ProvablyFair.org site's LIQD Plinko verifier, pinned and loaded (profile PLINKO-24,
 * player-verifier parity).
 *
 * WHAT IS PINNED. The site's VerifyBets component ships `games/plinko/derive.js` for LIQD
 * (the ProvablyFair.org site repository, src/components/VerifyBets/). It
 * imports two things: `hmacSha256Hex` / `hexToBytes` from `../../lib/hmac-sha256` and
 * `paytable` / `effectiveRows` / `WTF_RISK_LEVEL` from `./paytables`. Those three files are
 * what runs when a player presses Verify on that page, so all three are vendored byte for
 * byte into verifier-parity/ and their SHA-256 digests are recorded below. The fourth file,
 * `games/plinko/source.js`, is the page's SOURCE CARD — the text the page shows the player as
 * "the code that verified your bet". It is pinned too, and Step 5 requires its text to BE
 * derive.js, byte for byte, so the card cannot show one program while another one runs.
 *
 * HOW IT RUNS WITHOUT A BUNDLER (the same loader as this audit's LIQD Mines package, src/site-verifier.ts there):
 *   1. read each vendored file and hash its UNMODIFIED bytes against SITE_VERIFIER_PINS;
 *   2. strip ONLY the ES-module syntax — `export ` at the start of a declaration line, and the
 *      import lines, which must equal the lines below exactly — so any other change to the
 *      module surface is a load error rather than a silent rewrite;
 *   3. evaluate each file in a fresh node:vm context whose only injected names are the ones it
 *      imports (plus TextEncoder, which derive.js reads for non-hex seeds).
 * Nothing here compares outcomes; Step 5 does that, on every captured bet.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createHash } from 'crypto';

/** Directory (relative to the package root) holding the byte-exact copies. */
export const SITE_VERIFIER_DIR = 'verifier-parity';

/**
 * SHA-256 of the site files, taken 2026-09-24 from the ProvablyFair.org site repository (branch main,
 * HEAD 0625438, all four files equal to HEAD). They move only by a deliberate re-vendor + re-pin.
 */
export const SITE_VERIFIER_PINS: ReadonlyArray<{ file: string; sha256: string }> = [
  { file: 'games/plinko/derive.js', sha256: 'c4887e7bdf8847d1f02fc4a68089b745bcff8c67808de2bd87e14d170ee3ff82' },
  { file: 'games/plinko/paytables.js', sha256: '12602b48e4af8a803cee4bb6408842fa4e039fdf4447aeb52f31672d7e618323' },
  { file: 'games/plinko/source.js', sha256: '9f501ca915776837cf94e804ce0aad79811f8903ae29066179a724ca34c1e8de' },
  { file: 'lib/hmac-sha256.js', sha256: '2095571fecd77f536bb3363c801cd70786856e687d108e0ff2102a4e2a18b847' },
];

export const DERIVE_IMPORT_LINES = [
  "import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';",
  "import { paytable, effectiveRows, WTF_RISK_LEVEL } from './paytables';",
];

export interface SiteDerived {
  path: string;
  slot: number;
  rows: number;
  riskLevel: number;
  wtf: boolean;
  multiplier: number;
}

export interface SiteVerifier {
  derivePlinko: (p: { clientSeed: string; serverSeed: string; nonce: number; rows: number; riskLevel: number }) => SiteDerived;
  multipliersFor: (rows: number, riskLevel: number) => number[];
  /** The source card's text (source.js default export). */
  sourceCardText: string;
  /** derive.js as vendored, unmodified. */
  deriveText: string;
}

export interface SiteVerifierLoad {
  files: Array<{ file: string; sha256: string; pinned: string; ok: boolean }>;
  hashesOk: boolean;
  verifier: SiteVerifier | null;
  error: string | null;
}

function stripExports(src: string, label: string): string {
  const out = src.replace(/^export (function|const|let|class) /gm, '$1 ');
  if (/^\s*export\b/m.test(out)) throw new Error(`${label}: an export form other than "export function/const" remains`);
  return out;
}

export function loadSiteVerifier(packageRoot: string): SiteVerifierLoad {
  const dir = path.join(packageRoot, SITE_VERIFIER_DIR);
  const bytes = new Map<string, Buffer>();
  const files = SITE_VERIFIER_PINS.map(p => {
    const fp = path.join(dir, p.file);
    const buf = fs.existsSync(fp) ? fs.readFileSync(fp) : null;
    if (buf) bytes.set(p.file, buf);
    const sha256 = buf ? createHash('sha256').update(buf).digest('hex') : 'ABSENT';
    return { file: p.file, sha256, pinned: p.sha256, ok: sha256 === p.sha256 };
  });
  const hashesOk = files.length === 4 && files.every(f => f.ok);
  if (!hashesOk) return { files, hashesOk, verifier: null, error: 'vendored bytes do not match the pinned digests' };
  try {
    const lib = stripExports(bytes.get('lib/hmac-sha256.js')!.toString('utf8'), 'lib/hmac-sha256.js');
    if (/^\s*import\b/m.test(lib)) throw new Error('lib/hmac-sha256.js: unexpected import');
    const libX = vm.runInNewContext(`${lib}\n;({ hmacSha256Hex, hexToBytes });`, {}, { filename: 'lib/hmac-sha256.js' });

    const pt = stripExports(bytes.get('games/plinko/paytables.js')!.toString('utf8'), 'games/plinko/paytables.js');
    if (/^\s*import\b/m.test(pt)) throw new Error('games/plinko/paytables.js: unexpected import');
    const ptX = vm.runInNewContext(`${pt}\n;({ paytable, effectiveRows, WTF_RISK_LEVEL, multipliersFor });`, {},
      { filename: 'games/plinko/paytables.js' });

    const deriveText = bytes.get('games/plinko/derive.js')!.toString('utf8');
    const lines = deriveText.split('\n');
    const imports = lines.filter(l => /^\s*import\b/.test(l));
    if (imports.length !== DERIVE_IMPORT_LINES.length || imports.some((l, i) => l !== DERIVE_IMPORT_LINES[i]))
      throw new Error(`games/plinko/derive.js: expected exactly the import lines ${JSON.stringify(DERIVE_IMPORT_LINES)}, found ${JSON.stringify(imports)}`);
    const derive = stripExports(lines.filter(l => !DERIVE_IMPORT_LINES.includes(l)).join('\n'), 'games/plinko/derive.js');
    const dX = vm.runInNewContext(`${derive}\n;({ derivePlinko });`, {
      hmacSha256Hex: libX.hmacSha256Hex, hexToBytes: libX.hexToBytes,
      paytable: ptX.paytable, effectiveRows: ptX.effectiveRows, WTF_RISK_LEVEL: ptX.WTF_RISK_LEVEL,
      TextEncoder,
    }, { filename: 'games/plinko/derive.js' });

    // source.js: `const SOURCE = [ ...lines ].join('\n');` then `export default SOURCE;`.
    const srcText = bytes.get('games/plinko/source.js')!.toString('utf8');
    const DEFAULT_EXPORT = 'export default SOURCE;';
    const srcLines = srcText.split('\n');
    if (srcLines.filter(l => /^\s*(export|import)\b/.test(l)).join('|') !== DEFAULT_EXPORT)
      throw new Error(`games/plinko/source.js: expected exactly one module line "${DEFAULT_EXPORT}"`);
    const sourceCardText = vm.runInNewContext(
      `${srcLines.filter(l => l !== DEFAULT_EXPORT).join('\n')}\n;SOURCE;`, {}, { filename: 'games/plinko/source.js' });

    if (typeof dX.derivePlinko !== 'function' || typeof ptX.multipliersFor !== 'function' || typeof sourceCardText !== 'string')
      throw new Error('derivePlinko / multipliersFor / SOURCE not defined');
    return {
      files, hashesOk, error: null,
      verifier: { derivePlinko: dX.derivePlinko, multipliersFor: ptX.multipliersFor, sourceCardText, deriveText },
    };
  } catch (e) {
    return { files, hashesOk, verifier: null, error: (e as Error).message };
  }
}
