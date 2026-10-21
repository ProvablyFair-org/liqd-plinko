/**
 * Spec self-test — docs/ALGORITHM.md vectors (§1.2 page example, §5 V1–V5) and properties, run
 * against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the
 * module interface alone (never from LIQD's code). Integrated 20 Oct 2026: the checks are unchanged;
 * only the import path, the mocha wrapper and the reporting (failures collected instead of printed)
 * were adapted.
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
      id: "V1", serverSeed: "fc9a1d6fad00e0832fddfdea45435c85",
      commitment: "3b34a0fce5732f2d9c89b16fca9c2b6a231c2b7f2de29bbc41e141861dc39d36",
      clientSeed: "auditb1141320acde", nonce: 0, rows: 8,
      digest1: "1bc5cc26bf9ba6d661badc7907e87182fd2a3b9e3a9f4e183789cbd37d14db12",
      u32: [465947686, 261972339, 3688591245, 4099969822, 3461456877, 91014705, 217623221, 325826245],
      path: "01101111", slot: 6,
    },
    {
      id: "V2", serverSeed: "ea78c284099479c0624dcc65bd49a6b4",
      commitment: "4a20f49109bae29e360b795bb26ee9d2d1a41545cfd9e7db9d55c5291d4d752a",
      clientSeed: "auditfdbdfd859cad", nonce: 4, rows: 16,
      digest1: "14a65daf28f097e59a986d398ba5c41975fc2c8ffb33c4c08e55e9e2d77e1939",
      u32: [346447279, 1187183741, 504372685, 2146127743, 3132006485, 4121536863, 3580981619, 1665279301,
        3177010849, 2445154865, 2892111452, 3238620967, 1061105011, 1168669417, 1313618577, 2487409767],
      path: "1111111111011111", slot: 15,
    },
    {
      id: "V3", serverSeed: "7946393604bd5d1a42972a32dcb34a6c",
      commitment: "ac6291949101c6057cb6d48818b13229ee3085fb9877642c5c64118343cacf50",
      clientSeed: "audit4235425fddbb", nonce: 18, rows: 16,
      digest1: "8f6617f7a56642a390b297adfb8cba0fdf324414a97b72a2bfe60b18f3db617d",
      u32: [2405832695, 842234661, 2664265389, 1239853252, 555793299, 1955308833, 1660070429, 700809953,
        3925203730, 3097751101, 2464513283, 3083207281, 634065437, 907262603, 4272985791, 1693099616],
      path: "1110111101111110", slot: 13,
    },
    {
      id: "V4", serverSeed: "d7fc3e5d19db3e1646ffc5ec1da2bb9a",
      commitment: "d36168fe4bd1110de73dd9bf67919c3f6c12414468f5fce7b811c90d5be9ac9a",
      clientSeed: "pfaudit-1783390325646-152", nonce: 13, rows: 12,
      digest1: "b09c64f83793d74eff688e3cc48642d1d7f13edab56cccb64e5a5b876e724fdb",
      u32: [2963039480, 609955217, 1753020910, 2092186930, 3168917280, 4228365897, 2546896041, 408347392,
        1501153080, 100619428, 1009938668, 1422609502],
      path: "010001100000", slot: 3,
    },
    {
      id: "V5", serverSeed: "0d249f81e03a903d6b17c71ebc82817a",
      commitment: "1e74e08a9dd50f50ef689e15b52a37ca15c83fbcb1b166202a85f7ea78cec70b",
      clientSeed: "auditc680c9435be0", nonce: 32, rows: 13,
      digest1: "a8a25bc36f1d2b339d641ada2ad3a1fa653ef6cbba4dd9ff9c2fa7a464b88450",
      u32: [2829212611, 3975601995, 3693746059, 345428137, 2205473013, 320649226, 2045002243, 2307408443,
        2466660811, 2056615533, 5637941, 1289934329, 2014158041],
      path: "1111101111111", slot: 12,
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
  check("message example auditb1141320acde:0:8", getProvablyFairHmacSalt("auditb1141320acde", 0, 8) === "auditb1141320acde:0:8");

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
