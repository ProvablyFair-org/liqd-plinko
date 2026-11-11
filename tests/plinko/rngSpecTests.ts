/**
 * Spec self-test — docs/ALGORITHM.md vectors (§1.2 page example, §5 V1–V5) and properties, run
 * against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the
 * module interface alone (never from LIQD's code). Integrated 20 Oct 2026: only the import path, the
 * mocha wrapper and the reporting (failures collected instead of printed) were adapted. 10 Nov 2026:
 * the five §5 vectors and the message example are the production ones of the revised
 * docs/ALGORITHM.md (printed by `node scripts/spec-check.mjs --vectors` from the production dataset);
 * the checks themselves are unchanged.
 */
import { strict as assert } from 'node:assert';
import { createHmac } from "crypto";
import { commitHash, sha256Buffer, getProvablyFairHmacSalt, generateProvablyFairNumber, revealPlinko } from "../../src/rng";

const EXPECTED_CHECKS = 55;

function runSelftest(): { passed: number; total: number; failed: string[] } {
  let pass = 0;
  let total = 0;
  const failed: string[] = [];
  function check(name: string, ok: boolean, detail = ""): void {
    total++;
    if (ok) pass++;
    if (!ok) failed.push(`${name}${detail ? "  " + detail : ""}`);
  }

  interface Vec {
    id: string;
    serverSeed: string;
    commitment: string;
    clientSeed: string;
    nonce: number;
    rows: number;
    digest1: string;
    u32: number[];
    path: string;
    slot: number;
  }

  // Copied from ALGORITHM.md §5 (V1..V5).
  const vectors: Vec[] = [
    {
      id: "V1", serverSeed: "9ef0b85313bd2d1b8d96e22df9b08ff4",
      commitment: "fc09cc34555528c74b6242b31ea0fbe2e4a51b085b66d58c5aa50d68b1c090fd",
      clientSeed: "auditf011676cf201", nonce: 0, rows: 8,
      digest1: "5269454bf2bc713c77ed5c6f9fb6c4a14d689cd68b8b9ac1f21453cd547e9c21",
      u32: [1382630731, 2843172180, 3774875546, 736692549, 4033295762, 990658859, 1408222412, 2487925249],
      path: "10010101", slot: 4,
    },
    {
      id: "V2", serverSeed: "715bcb6f4a43571308e03e95b99931bc",
      commitment: "bc99a69f4b131bf7cebc8cd4267b8559c7524769eaade6737314528257fa4d03",
      clientSeed: "audit08d03eedd4b7", nonce: 122, rows: 16,
      digest1: "10a520d28b3ee526a0b0b8cb1edd7aac8d7bf539442f93514483ec59510b010c",
      u32: [279257298, 2459872134, 847434472, 2983027234, 3429187080, 2721595078, 3082358334, 2282858064,
        735793118, 430178866, 461077886, 4170719104, 3446436280, 1367243104, 3863180374, 1986618352],
      path: "0000000000000000", slot: 0,
    },
    {
      id: "V3", serverSeed: "eb417d31525821f1278b0ccea8edeb18",
      commitment: "45996e535bce855e59b8f945d0f3adb3447e4040b7f3ddbed25c48551fe087de",
      clientSeed: "audit65a06fd5119c", nonce: 9, rows: 16,
      digest1: "fd807e735aff094bb3759c956e5b4396ec3f5f89233cba9d6e65bd461aac32a7",
      u32: [4253056627, 853350442, 3769460548, 1875099557, 2991491813, 2444037069, 977134801, 2770240191,
        1524905081, 2936522273, 2279798965, 3273965895, 2417993271, 3757241147, 683083631, 2935554119],
      path: "1001111111111111", slot: 14,
    },
    {
      id: "V4", serverSeed: "afdbff1826807b581e82e15ccd53a90d",
      commitment: "df6243d149a59eafbd9e6e6986bdc7c1806f25a12960d4452f6019e539a9b0af",
      clientSeed: "pfaudit-prod-plinko-d3-b43f85abca8a", nonce: 15, rows: 16,
      digest1: "f7d4c4c1a6efbbee65b1f04957bba49aa9b53f85e77273ca7d90f0ae04ef7c80",
      u32: [4157916353, 2112150979, 2642622427, 3886798582, 639340445, 2478021331, 1753002797, 3587131851,
        3629458181, 4153036531, 3354855894, 2658060931, 1018867619, 1939733663, 3834424449, 3586559355],
      path: "1110111111011111", slot: 14,
    },
    {
      id: "V5", serverSeed: "0d37ca1328cc862aead5e3aa5f2d853d",
      commitment: "136668587a94490a30f2802f6060ccbac102697707d70e4cca914ab345d79b9f",
      clientSeed: "audit2737549576ae", nonce: 34, rows: 13,
      digest1: "ad3c9e7d1040b1f075bc27ab79b4ec7390e7faadbd5850f659a2054a30804e2f",
      u32: [2906431101, 1901887950, 2075721589, 334739687, 2593919865, 3658226095, 3128206033, 1524910409,
        1515008241, 2858343663, 189450267, 684219243, 4291166137],
      path: "1011111111111", slot: 12,
    },
  ];

  // §1.2 page example: commitment = SHA-256 of the 64 ASCII characters.
  const pageSeed = "c732c958f6d41e0a7b3549ce8f2b1d64a09e5837cc4b1f2ae6d80935b7c4a1e2";
  const pageHash = "2ff2e8260adf6f9582913c897ee8e73224255623c55d40a3dd8060b1ab2cdecd";
  check("page example: commitHash(seed) == shown hash", commitHash(pageSeed) === pageHash);
  const decodedForm = sha256Buffer(Buffer.from(pageSeed, "hex"));
  check("page example: decoded-bytes form != shown hash", decodedForm !== pageHash);
  check("page example: decoded-bytes form matches spec's 9a17dc14…dab66a",
    decodedForm.startsWith("9a17dc14") && decodedForm.endsWith("dab66a"), decodedForm);

  const TWO_POW_32 = 4294967296;
  for (const v of vectors) {
    check(`${v.id} commitment`, commitHash(v.serverSeed) === v.commitment);
    check(`${v.id} commitment equals sha256Buffer(ascii)`, sha256Buffer(Buffer.from(v.serverSeed, "ascii")) === v.commitment);
    check(`${v.id} hash check false on wrong seed`, commitHash(v.serverSeed.replace(/.$/, (c) => (c === "0" ? "1" : "0"))) !== v.commitment);
    const msg1 = getProvablyFairHmacSalt(v.clientSeed, v.nonce, 1);
    check(`${v.id} message r=1`, msg1 === `${v.clientSeed}:${v.nonce}:1`, msg1);
    const d1 = createHmac("sha256", Buffer.from(v.serverSeed, "hex")).update(msg1, "utf8").digest("hex");
    check(`${v.id} digest_1`, d1 === v.digest1);
    // range 2^32 makes the draw the raw u32 itself, so the exported function is checked against every listed u32.
    const u = Array.from({ length: v.rows }, (_, i) => generateProvablyFairNumber(v.serverSeed, v.clientSeed, v.nonce, i + 1, TWO_POW_32));
    check(`${v.id} u32 r=1..${v.rows}`, u.length === v.u32.length && u.every((x, i) => x === v.u32[i]));
    const bits = Array.from({ length: v.rows }, (_, i) => generateProvablyFairNumber(v.serverSeed, v.clientSeed, v.nonce, i + 1, 2));
    check(`${v.id} bits == u32 mod 2`, bits.every((b, i) => b === v.u32[i] % 2));
    const out = revealPlinko(v.serverSeed, v.clientSeed, v.nonce, v.rows);
    check(`${v.id} path`, out.path === v.path, out.path);
    check(`${v.id} slot`, out.winningSlot === v.slot, String(out.winningSlot));
  }

  // Message format example from §2 Step 1.
  check("message example auditf011676cf201:0:8", getProvablyFairHmacSalt("auditf011676cf201", 0, 8) === "auditf011676cf201:0:8");

  // Properties: ranges and path/slot consistency over many random drops.
  let rangeOk = true;
  let consistOk = true;
  let ones = 0;
  let draws = 0;
  for (let n = 0; n < 500; n++) {
    const rows = 8 + (n % 9);
    const out = revealPlinko("00112233445566778899aabbccddeeff", "prop-seed", n, rows);
    if (out.path.length !== rows || !/^[01]+$/.test(out.path) || out.winningSlot < 0 || out.winningSlot > rows) rangeOk = false;
    const count = out.path.split("").filter((c) => c === "1").length;
    if (count !== out.winningSlot) consistOk = false;
    ones += count;
    draws += rows;
    const r6 = generateProvablyFairNumber("00112233445566778899aabbccddeeff", "prop-seed", n, 1, 6);
    if (!Number.isInteger(r6) || r6 < 0 || r6 >= 6) rangeOk = false;
  }
  check("property: path length = rows, bits 0/1, slot in [0, rows], draws in [0, range)", rangeOk);
  check("property: slot == number of '1' in path", consistOk);
  // Bias report: u mod range over 2^32 values is unbiased iff range divides 2^32; for range 2 the bound is 0 (§2 Step 2).
  const biasRange2 = TWO_POW_32 % 2;
  check("bias report: range 2 excess count 2^32 mod 2 == 0 (spec bound 0)", biasRange2 === 0);
  const z = (ones - draws / 2) / Math.sqrt(draws / 4);
  check("bias report: observed share of 1-bits within 5 sigma of 1/2", Math.abs(z) < 5, `ones=${ones}/${draws} z=${z.toFixed(3)}`);
  // Input validation: bad rows / bad hex rejected.
  let threw = false;
  try { revealPlinko(vectors[0].serverSeed, "x", 0, 7); } catch { threw = true; }
  check("rows 7 rejected", threw);
  threw = false;
  try { generateProvablyFairNumber("zz", "x", 0, 1, 2); } catch { threw = true; }
  check("non-hex server seed rejected", threw);

  return { passed: pass, total, failed };
}

describe('rng: docs/ALGORITHM.md spec self-test (clean-room vectors and properties)', () => {
  it(`all ${EXPECTED_CHECKS} spec checks pass on src/rng.ts`, () => {
    const r = runSelftest();
    assert.deepEqual(r.failed, [], `failed spec checks: ${r.failed.join(' | ')}`);
    assert.equal(r.total, EXPECTED_CHECKS);
    assert.equal(r.passed, EXPECTED_CHECKS);
  });
});
