# LIQD Plinko: clean-room algorithm specification

**Production revision, 10 November 2026.** The construction specified here (§1 to §3) is the text of the
clean-room specification written on 20 October 2026 for the ProvablyFair.org audit framework
(`games/liqd-plinko/ALGORITHM.md`). In this revision every line marked DATA was measured again, on the
production dataset of this package (`data/plinko-prod-9750bets.json`, 9,750 drops played on `liqd.com` on 7, 9
and 10 November 2026), by `scripts/spec-check.mjs`; §5 gives vectors from that dataset and §7 prints the
script's output. The script is a second, independent
implementation written out from this text; it was written by the auditor, who had seen the package code, so
the re-measurement is not itself clean-room work (§8).

This document is the only input an implementer needs to rebuild LIQD Plinko's
outcome derivation and settlement (LIQD Originals, `liqd.com/originals/plinko`). The 20 October text was
written without opening any LIQD source code, any port of it, any saved LIQD JavaScript, any audit-package
code or notes, or LIQD's in-game Verify tab (§8). Every step names where it came from:

- **PAGE**: LIQD's public production pages, quoted with URL and read time. The page reads
  are saved in this package as `evidence/liqd-plinko-page-reads-2026-10-20.json` (SHA-256
  `769754a5cb5ddd1156759940ca6b000982b5872384103a66d997fad4b093aab0`).
- **STANDARD**: the standard provably-fair construction used across the
  industry (commit to SHA-256 of a server seed; HMAC-SHA256 keyed by the server
  seed over `clientSeed:nonce:cursor`; bytes to integer).
- **DATA**: fixed by testing the standard candidates against the 9,750 production
  drops in `data/plinko-prod-9750bets.json` (SHA-256 `83965cdc…edea8a16`, three captures on
  `liqd.com`: 25 epochs of 200 on 7 Nov 2026; 5 of 100, 20 of 200 and 1 of 50 on 9 Nov; 1 of 200 on
  10 Nov). The data chose; LIQD's code did not.

LIQD's pages name the primitive (HMAC-SHA256), the commitment and
the "count the rights" rule. The key form, message format, cursor base and bit
rule were settled by DATA.

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 32 lowercase hex characters (16 bytes); secret until the seed pair is rotated | PAGE: "Server Seed — Hidden Until Revealed. A random secret we generate for you. While it's in use you see only its hash." (`liqd.com/provably-fair`, read 2026-10-20T14:19Z). Form: DATA (all 52 revealed seeds and the 3 pre-capture seeds are 32 lowercase hex chars) |
| `clientSeed` | text string | PAGE: "Client Seed — Always Visible. Random by default, yours to change to anything." DATA: capture seeds are 17 chars (`audit` + 12 hex, 9,250 bets, 47 seeds) and 35 chars (`pfaudit-prod-plinko-d3-b43f85abca8a` style, Phase D, 500 bets, 5 seeds) |
| `nonce` | non-negative integer, 0 on the first bet of a seed pair, +1 per bet | PAGE: "Nonce — Automatic. A simple counter that ticks up with every bet". DATA: all 52 epochs carry nonces exactly 0…n−1 (n = 200 on 46 epochs, 100 on 5, 50 on 1) |
| `rows` | integer 8…16 (`numberOfRows`) | PAGE: "Rows 8 to 16" (Game Info table, `liqd.com/originals/plinko`, read 2026-10-20T14:18Z) |
| `risk` | Low / Medium / High / WTF; `riskLevel` 1 / 2 / 3 / 4 | PAGE: "Risk levels Low, Medium, High, WTF"; "Select it and the row picker locks at 13". DATA: the id↔name mapping is fixed by the table match in §3 (9,750 / 9,750); every WTF bet (2,050) is `riskLevel 4`, `numberOfRows 13` |
| `amount` | stake, decimal (`betAmount`, 8 dp string) | DATA (`0.10000000` × 9,550, `10.00000000` × 200) |

### 1.2 Commitment

PAGE (`liqd.com/provably-fair`, read 2026-10-20T14:19Z):

> "The hash is published before your first bet and can't be changed afterwards.
> When the seed is revealed on rotation, it hashes back to exactly the
> commitment you were shown."

and the worked example on the same page:

> "Hash Of Server Seed SHOWN BEFORE YOU BET
> 2ff2e8260adf6f9582913c897ee8e73224255623c55d40a3dd8060b1ab2cdecd
> Server Seed REVEALED AFTER ROTATION
> c732c958f6d41e0a7b3549ce8f2b1d64a09e5837cc4b1f2ae6d80935b7c4a1e2"

Spec:

```
commitment = lowercase_hex( SHA-256( ASCII(serverSeed) ) )
```

i.e. hash the **32 ASCII characters** of the seed as written, **not** the 16
bytes they hex-encode. (Note the asymmetry with §2, where the HMAC key is the
decoded bytes.)

- SOURCE: PAGE + DATA. The page example reproduces under the ASCII form
  (SHA-256 of the 64 ASCII characters = `2ff2e826…2cdecd`, the shown hash) and
  not under the decoded form (`9a17dc14…dab66a`). On the dataset: ASCII form
  → **52 / 52** bet hashes resolve, covering **9,750 / 9,750** bets;
  decoded-bytes form → **0 / 52**. The 3 pre-capture seeds also resolve.
- **Pair seeds to bets by hashing, not by record position.** In this capture
  each seed record's own `hashedServerSeed` equals the commitment of its own
  `serverSeed` (52 / 52), but an implementation should still look a bet's
  seed up by `commitment(seed) == bet.hashedServerSeed`.
- Forward chain: inside each of the three captures, each record's
  `nextHashedServerSeed` equals the next record's `hashedServerSeed` on
  **49 / 49** transitions, and each capture's pre-capture record
  (`meta.captures[i].preCapture.nextHashedServerSeed`) equals the hash of that
  capture's first epoch (3 / 3). No link exists across two captures: other play
  on the account separates them. PAGE: "When you rotate … We hand over the old
  server seed in full, and a new one (already hashed) takes its place."

---

## 2. Outcome derivation

PAGE (`liqd.com/provably-fair`):

> "Outcome = Server Seed + Client Seed + Nonce. Combined with HMAC-SHA256.
> One-way, deterministic, checkable by anyone."
>
> "Plinko — Each row is one left-or-right call. Count the rights and you've got
> your bucket."

PAGE (`liqd.com/originals/plinko`, "Verifying A Drop"):

> "The game runs HMAC-SHA256 over those inputs and the result decides the
> bucket the ball lands in. The bucket is fixed before the ball appears."

The outcome of a drop is a **path** of `rows` bits and a **slot** (bucket
index 0…`rows`, counted from the left of the multiplier strip).

### Step 1: one HMAC per row, cursor starting at 1

```
key = hex_decode(serverSeed)                                   # 16 bytes
for r in 1, 2, …, rows:                                        # r = row cursor
    message_r = UTF-8( clientSeed + ":" + decimal(nonce) + ":" + decimal(r) )
    digest_r  = HMAC-SHA256(key, message_r)                     # 32 bytes
```

Example messages: `auditf011676cf201:0:1`, `auditf011676cf201:0:2`, …,
`auditf011676cf201:0:8` for an 8-row drop.

- `decimal(x)` is plain base 10: no padding, no sign, no separators.
- The cursor starts at **1**, not 0, and there is **one HMAC per row**. Only the
  first 4 bytes of each digest are used.
- SOURCE: PAGE (HMAC-SHA256; server seed, client seed and nonce as inputs) +
  STANDARD (server seed as key, `clientSeed:nonce:cursor` as message) + DATA
  for the key form (decoded bytes), the cursor base (1) and one digest per row.

### Step 2: bit per row

```
u_r   = digest_r[0..3] read as an unsigned 32-bit BIG-ENDIAN integer
bit_r = u_r mod 2                     # = lowest bit of digest_r[3]
```

- `u mod 2` on a 2^32 domain is exactly unbiased (P(1) = 2^31 / 2^32 = 1/2);
  no rejection step exists or is needed. Bias bound for PLINKO-08: 0.
- SOURCE: DATA.

### Step 3: path and slot

```
path = bit_1 bit_2 … bit_rows          # as a string, row 1 first
slot = bit_1 + bit_2 + … + bit_rows    # 0 ≤ slot ≤ rows
```

- The served `dropDetails` string equals `path` character for character, row 1
  first, on **9,750 / 9,750** bets; `winningSlot` equals `slot` on
  **9,750 / 9,750** (mirrored `rows − slot`: 1,126).
- SOURCE: PAGE ("Count the rights and you've got your bucket") + DATA. The page
  sentence implies bit 1 = a bounce to the right and slot 0 = the leftmost
  bucket; the data cannot check the screen direction because every table is
  symmetric (O2).

### Candidates tried (all on the full 9,750 bets)

"path" = whole `dropDetails` string equal; "slot" = `winningSlot` equal. Each
row gives the best score over the variants it names (`scripts/spec-check.mjs`).

| Construction | path | slot |
|---|---|---|
| **key = hex-decoded seed; one HMAC per row, msg `c:n:r`, r = 1…rows; bit = u32 BE (first 4 bytes) mod 2** | **9,750** | **9,750** |
| same, r = 0…rows−1 | 5 | 4,799 (rows 1…rows−1 share bits, hence above chance) |
| same (r from 0 or 1), bit = u32 little-endian mod 2 | ≤ 11 | ≤ 1,570 |
| same (r from 0 or 1), bit = first byte ≥ 128 (≡ 4-byte float ≥ 0.5) | ≤ 5 | ≤ 1,483 |
| key = the 32-char ASCII seed; per-row HMAC, r from 0 or 1, each of the 3 bit rules | ≤ 8 | ≤ 1,552 |
| one byte stream from msg `c:n:cursor` (cursor from 0 or 1), consecutive 4-byte chunks per row, each of the 3 bit rules, either key form | ≤ 11 | ≤ 1,620 |
| single HMAC msg `c:n`, `c:n:0`, `c-n`, either key form, first `rows` bits of the digest MSB-first or LSB-first | ≤ 7 | ≤ 1,558 |

Wrong constructions with no shared bits scored at most 1,620 / 9,750 on slot
(two independent binomial draws on the same board coinciding) and at most 11
on the full path.

---

## 3. Win condition and payout

Plinko has no separate win/lose draw: every drop pays `amount × multiplier`,
where the multiplier depends only on `rows`, `risk` and `slot`.

### 3.1 Multiplier table

Read from the public game page's bucket strip (`liqd.com/originals/plinko`,
read logged out 2026-10-20T14:21Z by selecting each risk button and stepping
the Rows slider; saved in `evidence/liqd-plinko-page-reads-2026-10-20.json` → `boardLabels`).
Slot 0 first. Every row is left/right symmetric.

| rows | Low | Medium | High |
|---|---|---|---|
| 8 | 5.6 2.1 1.1 1 0.5 1 1.1 2.1 5.6 | 13 3 1.3 0.7 0.4 0.7 1.3 3 13 | 29 4 1.5 0.3 0.2 0.3 1.5 4 29 |
| 9 | 5.6 2 1.6 1 0.7 0.7 1 1.6 2 5.6 | 18 4 1.7 0.9 0.5 0.5 0.9 1.7 4 18 | 43 7 2 0.6 0.2 0.2 0.6 2 7 43 |
| 10 | 8.9 3 1.4 1.1 1 0.5 1 1.1 1.4 3 8.9 | 22 5 2 1.4 0.6 0.4 0.6 1.4 2 5 22 | 76 10 3 0.9 0.3 0.2 0.3 0.9 3 10 76 |
| 11 | 8.4 3 1.9 1.3 1 0.7 0.7 1 1.3 1.9 3 8.4 | 24 6 3 1.8 0.7 0.5 0.5 0.7 1.8 3 6 24 | 120 14 5.2 1.4 0.4 0.2 0.2 0.4 1.4 5.2 14 120 |
| 12 | 10 3 1.6 1.4 1.1 1 0.5 1 1.1 1.4 1.6 3 10 | 33 11 4 2 1.1 0.6 0.3 0.6 1.1 2 4 11 33 | 170 24 8.1 2 0.7 0.2 0.2 0.2 0.7 2 8.1 24 170 |
| 13 | 8.1 4 3 1.9 1.2 0.9 0.7 0.7 0.9 1.2 1.9 3 4 8.1 | 43 13 6 3 1.3 0.7 0.4 0.4 0.7 1.3 3 6 13 43 | 260 37 11 4 1 0.2 0.2 0.2 0.2 1 4 11 37 260 |
| 14 | 7.1 4 1.9 1.4 1.3 1.1 1 0.5 1 1.1 1.3 1.4 1.9 4 7.1 | 58 15 7 4 1.9 1 0.5 0.2 0.5 1 1.9 4 7 15 58 | 420 56 18 5 1.9 0.3 0.2 0.2 0.2 0.3 1.9 5 18 56 420 |
| 15 | 15 8 3 2 1.5 1.1 1 0.7 0.7 1 1.1 1.5 2 3 8 15 | 88 18 11 5 3 1.3 0.5 0.3 0.3 0.5 1.3 3 5 11 18 88 | 620 83 27 8 3 0.5 0.2 0.2 0.2 0.2 0.5 3 8 27 83 620 |
| 16 | 16 9 2 1.4 1.4 1.2 1.1 1 0.5 1 1.1 1.2 1.4 1.4 2 9 16 | 110 41 10 5 3 1.5 1 0.5 0.3 0.5 1 1.5 3 5 10 41 110 | 1000 130 26 9 4 2 0.2 0.2 0.2 0.2 0.2 2 4 9 26 130 1000 |

**WTF (rows fixed at 13):** `1000 235 0 0 0 0 0 0 0 0 0 0 235 1000`.

- Label reading: the strip shows `1k` for High/16 slots 0 and 16 and for WTF
  slots 0 and 13; the page text gives the value: "Top multiplier 1,000x (High
  at 16 rows, WTF at 13 rows)". The WTF strip shows text labels only on the
  four outer buckets (`1k 235 235 1k`); the page text gives the rest: "the ten middle buckets pay
  nothing and show a skull … The two buckets next to the edges pay 235x, the
  two outermost pay 1,000x", and the WTF table "Middle ten — Skull, 0x".
- Cross-check: the page's
  "How The Boards Compare" table agrees on every edge and centre value it gives
  (Low 8 5.6x / 0.5x, Low 16 16x / 0.5x, Medium 8 13x / 0.4x, Medium 16 110x /
  0.3x, High 8 29x / 0.2x, High 16 1,000x / 0.2x). The page says "The three
  standard levels follow the industry-standard Plinko tables at 99% RTP, and
  WTF is the LIQD board."
- DATA: the served `multiplier`
  equals `table[rows][risk][slot]` on **9,750 / 9,750** bets with
  `riskLevel` 1/2/3/4 = Low/Medium/High/WTF. The data exercises **285 of the
  365** cells; the other 80 rest on the page labels alone (O3).
- SOURCE: PAGE (values) + DATA (risk ids, exact agreement on exercised cells).

### 3.2 Payout and the `result` label

```
winningAmount = amount × multiplier            # exact decimal product, 8 dp string
result        = "won" if multiplier ≥ 1 else "lost"
```

- DATA: exact decimal product equals the served `winningAmount` on
  **9,750 / 9,750** (served with 8 decimals, e.g. `0.05000000`, on 7,704 drops;
  the 2,046 WTF drops that pay nothing are served `"0"`). With these
  stakes and ≤ 1-dp multipliers the product is exact, so no rounding or
  truncation rule is exercised (O4).
- DATA: `result` is `won` iff multiplier ≥ 1 on **9,750 / 9,750** (699 drops
  at exactly 1x are labelled `won`; 5,126 drops that paid back a non-zero amount
  under 1x and 2,046 that paid nothing are labelled `lost`). The label does not affect money.
- Exact RTP per config, `Σ C(rows,k)/2^rows × m_k`, ranges from **0.989062**
  (8/Medium) to **0.991602** (11/High) over the 28 configs; WTF/13 is
  0.989990. PAGE claims "99% on every board" and "House Edge 1%". (Reported here as
  computed figures; the RTP-claim rule is applied by the audit, not by this
  spec.)
- SOURCE: STANDARD (stake × multiplier) + DATA.

### 3.3 Fields an implementation must not read

`dropDetails`, `winningSlot`, `multiplier`, `winningAmount` and
`result` are the operator's claims, to be checked. `localPath`, `localSlot`
and `verified` are the converter's own recomputation and must be ignored
(they are not used by `scripts/spec-check.mjs`). The derivation reads only
`serverSeed`, `clientSeed`, `nonce`, `numberOfRows`, `riskLevel`, `betAmount`
and the §3.1 table.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE | `liqd.com/provably-fair` "Three Ingredients" |
| Rows 8–16, risk Low/Medium/High/WTF, WTF fixed at 13 | PAGE + DATA | Game Info table; WTF section; 2,050 WTF bets all rows 13 |
| Commitment = SHA-256 of the ASCII seed | PAGE + DATA | page example pair reproduces (ASCII only); 52/52 (decoded 0/52) |
| Forward chain | PAGE + DATA | 49/49 inside the three captures + 3 pre-capture links |
| HMAC-SHA256 | PAGE | "Combined with HMAC-SHA256" |
| Key = hex-decoded seed, msg `clientSeed:nonce:r` | STANDARD + DATA | 9,750/9,750 path (ASCII key ≤ 8) |
| One HMAC per row, r = 1…rows | DATA | 9,750/9,750 (r from 0: path 5; streamed ≤ 11) |
| bit = first 4 bytes, big-endian u32, mod 2 | DATA | 9,750/9,750 (LE ≤ 11, byte ≥ 128 ≤ 5) |
| slot = number of 1-bits | PAGE + DATA | "Count the rights"; 9,750/9,750; mirrored 1,126 |
| multiplier = table[rows][risk][slot] | PAGE + DATA | board labels 20 Oct 2026; 9,750/9,750; 285/365 cells exercised |
| winningAmount = amount × multiplier | STANDARD + DATA | 9,750/9,750 exact |
| result = won iff multiplier ≥ 1 | DATA | 9,750/9,750 |

---

## 5. Test vectors (from the dataset)

Each vector is copied from `data/plinko-prod-9750bets.json` by
`node scripts/spec-check.mjs --vectors`; the server seed is
the revealed seed whose SHA-256 (of its ASCII text) equals the bet's
`hashedServerSeed`. `u32` is the first four bytes of `digest_r`, big-endian.
In all five, path, slot, multiplier and winningAmount equal the served
`dropDetails`, `winningSlot`, `multiplier` and `winningAmount`. V2 is a drop
that landed in a 1,000x bucket (16 rows, High, slot 0).

**V1: bet `4PmgyUj9xOP9CXphd0Wi0`** (Phase A, the first drop of the first capture; epoch 0, 8 rows, Low, nonce 0)
```
serverSeed  9ef0b85313bd2d1b8d96e22df9b08ff4
commitment  fc09cc34555528c74b6242b31ea0fbe2e4a51b085b66d58c5aa50d68b1c090fd
clientSeed  auditf011676cf201   nonce 0   rows 8   risk 1 (Low)   amount 0.10000000
digest_1 (msg "auditf011676cf201:0:1")
            5269454bf2bc713c77ed5c6f9fb6c4a14d689cd68b8b9ac1f21453cd547e9c21
u32 r=1..8 1382630731 2843172180 3774875546 736692549 4033295762 990658859 1408222412 2487925249
path        10010101   → slot 4
multiplier  0.5        winningAmount 0.05000000   result lost
```

**V2: bet `25W86HCn4PrfZmufod6Gb`** (Phase B, the highest multiplier in Phase B; epoch 35, 16 rows, High, nonce 122)
```
serverSeed  715bcb6f4a43571308e03e95b99931bc
commitment  bc99a69f4b131bf7cebc8cd4267b8559c7524769eaade6737314528257fa4d03
clientSeed  audit08d03eedd4b7   nonce 122   rows 16   risk 3 (High)   amount 0.10000000
digest_1 (msg "audit08d03eedd4b7:122:1")
            10a520d28b3ee526a0b0b8cb1edd7aac8d7bf539442f93514483ec59510b010c
u32 r=1..16 279257298 2459872134 847434472 2983027234 3429187080 2721595078 3082358334 2282858064 735793118 430178866 461077886 4170719104 3446436280 1367243104 3863180374 1986618352
path        0000000000000000   → slot 0
multiplier  1000        winningAmount 100.00000000   result won
```

**V3: bet `DPxB7CeG9KawitDYBSLLK`** (Phase C, stake 10, the highest multiplier in Phase C; epoch 51, 16 rows, High, nonce 9)
```
serverSeed  eb417d31525821f1278b0ccea8edeb18
commitment  45996e535bce855e59b8f945d0f3adb3447e4040b7f3ddbed25c48551fe087de
clientSeed  audit65a06fd5119c   nonce 9   rows 16   risk 3 (High)   amount 10.00000000
digest_1 (msg "audit65a06fd5119c:9:1")
            fd807e735aff094bb3759c956e5b4396ec3f5f89233cba9d6e65bd461aac32a7
u32 r=1..16 4253056627 853350442 3769460548 1875099557 2991491813 2444037069 977134801 2770240191 1524905081 2936522273 2279798965 3273965895 2417993271 3757241147 683083631 2935554119
path        1001111111111111   → slot 14
multiplier  26        winningAmount 260.00000000   result won
```

**V4: bet `Bf7iSHzTp0Kok4POS5gY8`** (Phase D, player-set client seed, the highest multiplier in Phase D; epoch 27, 16 rows, High, nonce 15)
```
serverSeed  afdbff1826807b581e82e15ccd53a90d
commitment  df6243d149a59eafbd9e6e6986bdc7c1806f25a12960d4452f6019e539a9b0af
clientSeed  pfaudit-prod-plinko-d3-b43f85abca8a   nonce 15   rows 16   risk 3 (High)   amount 0.10000000
digest_1 (msg "pfaudit-prod-plinko-d3-b43f85abca8a:15:1")
            f7d4c4c1a6efbbee65b1f04957bba49aa9b53f85e77273ca7d90f0ae04ef7c80
u32 r=1..16 4157916353 2112150979 2642622427 3886798582 639340445 2478021331 1753002797 3587131851 3629458181 4153036531 3354855894 2658060931 1018867619 1939733663 3834424449 3586559355
path        1110111111011111   → slot 14
multiplier  26        winningAmount 2.60000000   result won
```

**V5: bet `cDX_oAX6QiJ3afe1imueh`** (Phase E, WTF, the first drop that paid; epoch 41, 13 rows, WTF, nonce 34)
```
serverSeed  0d37ca1328cc862aead5e3aa5f2d853d
commitment  136668587a94490a30f2802f6060ccbac102697707d70e4cca914ab345d79b9f
clientSeed  audit2737549576ae   nonce 34   rows 13   risk 4 (WTF)   amount 0.10000000
digest_1 (msg "audit2737549576ae:34:1")
            ad3c9e7d1040b1f075bc27ab79b4ec7390e7faadbd5850f659a2054a30804e2f
u32 r=1..13 2906431101 1901887950 2075721589 334739687 2593919865 3658226095 3128206033 1524910409 1515008241 2858343663 189450267 684219243 4291166137
path        1011111111111   → slot 12
multiplier  235        winningAmount 23.50000000   result won
```

---

## 6. Open points the public sources do not settle

- **O1: the byte-level recipe is not published on the pages read.** The pages name HMAC-SHA256,
  the three inputs and "count the rights", but not the key form, the message
  separator, the cursor base (1), one digest per row, or the bit rule. Those
  rest on STANDARD + DATA. The provably-fair page has a "Technical
  Implementation" link and an in-page "Verify a Round" form; neither was opened
  for this spec (the first may show code). LIQD's own verifier is a separate
  witness, outside this spec: the capture runner called it once per round after
  the seed was revealed, and the capture checker's printouts in `evidence/`
  report its replies equal to the served round on every round of each capture.
- **O2: screen direction.** The page says the bucket is the count of rights,
  which reads as bit 1 = right and slot 0 = leftmost. All 28 tables are
  symmetric, so the data cannot confirm the direction, and which cursor is the
  top row is not visible in the data either. Neither affects the multiplier.
- **O3: 80 of 365 table cells are page-only.** The buckets that no captured
  drop landed in (e.g. WTF slots 0 and 13) rest on the 20 Oct 2026 board labels
  and page text, not on a paid bet. The labels were read on `liqd.com` on
  20 Oct 2026; the bets were placed on `liqd.com` on 7, 9 and 10 Nov 2026. They
  agree on all 285 exercised cells, but the page was not read again on the
  capture days and no machine-readable config was read. A strip label could in
  principle be a rounding of a longer value; on every exercised cell it was
  exact.
- **O4: rounding, caps and limits.** Every product in the data is exact at
  ≤ 3 dp, so no rounding or truncation rule is witnessed. The production bet
  replies carry no game-settings field (no minimum, maximum or profit cap is
  served with a bet); whether a profit cap limits a payout is not exercised
  (largest payout in the data: 260, V3). The page says "Min Bet 0.01 USDC
  equivalent"; no stake below 0.10 was played.
- **O5: client-seed encoding beyond ASCII.** UTF-8 is the assumption; all
  captured client seeds are ASCII.
- **O6: RTP figures vs the 99% claim.** The exact per-config RTP of the page
  table runs 0.989062–0.991602 (§3.2) against "99% on every board". This spec
  records the figures; the RTP-claim check belongs to the audit.

---

## 7. Reproduction of this spec

The construction is written out a second time, from this text and with Node's
`crypto` only, in `scripts/spec-check.mjs` (it imports nothing from `src/`). It
reads the dataset and the saved board labels and runs on every bet.
`node scripts/spec-check.mjs` prints:

```
dataset data/plinko-prod-9750bets.json sha256 83965cdc5381db3ad99bf7c1c1e1d2e0d90f574132f96642027599c0edea8a16: 9750 bets, 52 seed records, 3 captures
commitment SHA256(ascii serverSeed) resolves 52/52 bet hashes, covering 9750/9750 bets
  (SHA256(hex-decoded bytes): 0/52)
  seed records whose own hashedServerSeed == commitment(own serverSeed): 52/52
pre-capture records: SHA256(ascii revealedServerSeed) == hashedServerSeed: 3/3
server seed form (52 revealed seeds + 3 pre-capture seeds): 32 lowercase hex chars
forward chain nextHashedServerSeed[k] == hashedServerSeed[k+1] inside each capture: 49/49
pre-capture nextHashedServerSeed == the capture's first epoch hash: 3/3
epochs with nonces exactly 0..n-1: 52 / 52  (epoch lengths: 1 of 50, 5 of 100, 46 of 200)
client seed forms: audit + 12 hex (17 chars): 9250 bets, 47 seeds; pfaudit-prod-plinko-d<k>- + 12 hex (35 chars): 500 bets, 5 seeds
stakes (betAmount): 0.10000000 x 9550, 10.00000000 x 200
rows per riskLevel: riskLevel 1: 8,9,10,11,12,13,14,15,16; riskLevel 2: 8,9,10,11,12,13,14,15,16; riskLevel 3: 8,9,10,11,12,13,14,15,16; riskLevel 4: 13
path: bit_r = u32BE(HMAC-SHA256(key=hexdecode(serverSeed), "clientSeed:nonce:r")[0:4]) mod 2, r=1..rows; string == dropDetails: 9750/9750
slot = number of 1-bits == winningSlot: 9750/9750  (mirrored rows-sum: 1126/9750)
candidates (best path / best slot over the variants named), all on the full dataset:
  same, r = 0..rows-1: path <= 5, slot <= 4799
  same (r from 0 or 1), bit = u32 little-endian mod 2: path <= 11, slot <= 1570
  same (r from 0 or 1), bit = first byte >= 128: path <= 5, slot <= 1483
  key = the 32-char ASCII seed; per-row HMAC, r from 0 or 1, each of the 3 bit rules: path <= 8, slot <= 1552
  one byte stream from msg c:n:cursor (cursor from 0 or 1), consecutive 4-byte chunks per row, each of the 3 bit rules, either key form: path <= 11, slot <= 1620
  single HMAC msg c:n, c:n:0, c-n, either key form, first rows bits of the digest MSB-first or LSB-first: path <= 7, slot <= 1558
served multiplier == page board label table[rows][risk][slot] (1k=1000, WTF middle ten=0): 9750/9750
table cells exercised by the data: 285/365
winningAmount == betAmount x table multiplier (exact decimal): 9750/9750
result == "won" iff multiplier >= 1: 9750/9750  (drops at exactly 1x labelled won: 699; drops paying a non-zero amount under 1x labelled lost: 5126; drops paying 0 labelled lost: 2046)
winningAmount forms: 8-decimal string x 7704, "0" x 2046
largest payout in the data: 260.00000000 (bet DPxB7CeG9KawitDYBSLLK)
exact RTP over 28 configs: min 0.989062 at (8, 2), max 0.991602 at (11, 3); WTF/13 0.989990
symmetric tables: 28 / 28

spec-check: OK
```

`node scripts/spec-check.mjs --vectors` also prints the §5 vectors.

---

## 8. Files and pages read

For the 20 October 2026 text (the construction): the live production pages,
logged out, GET only, rendered in a fresh browser context on 20 Oct 2026:
`https://liqd.com/originals/plinko` (page text, meta description, and the
bucket-strip labels for every rows/risk, read by clicking the risk buttons and
moving the Rows slider; no bet, nothing typed) and
`https://liqd.com/provably-fair` (page text); the framework's Plinko profile and
two specs of other games as models of shape. Not opened for that
text: `src/`, `tests/`, `scripts/`, `capture/`, `outputs/`, `verifier-parity/`,
`verify.js`, `test.js`, `replay.js`, `plinkoConfig.json`, `MANIFEST.md` or
`README.md` of any LIQD package; any LIQD JS bundle; LIQD's in-game Verify tab;
the provably-fair page's "Technical Implementation" section.

For this revision (the DATA lines, §5 and §7): `data/plinko-prod-9750bets.json`
and `evidence/liqd-plinko-page-reads-2026-10-20.json`, read by
`scripts/spec-check.mjs`. The script's author had read this package's code, so
the re-measurement is an independent second implementation of this text, not a
clean-room one.
