# LIQD Plinko: clean-room algorithm specification

Copy of the framework spec (SHA-256 3376ef22a74641444f4726ae33d6e3de9ee7480e6a40a099f91d72b2d1ad70bb, the hash cited in src/rng.ts); local workspace paths and tool names replaced by neutral wording, nothing else changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of LIQD Plinko (LIQD
Originals, `liqd.com/originals/plinko`; audited capture from `qa.liqd.com`).

This document is the only input an implementer needs to rebuild LIQD Plinko's
outcome derivation and settlement. It was written without opening any LIQD
source code, any port of it, any saved LIQD JavaScript, any audit-package code
or notes, or LIQD's in-game Verify tab (see §8 for every file and page read).
Every step names where it came from:

- **PAGE**: LIQD's public pages, quoted with URL and read time. The page reads
  are saved beside this file as `page-reads-2026-10-20.json` (SHA-256
  `769754a5cb5ddd1156759940ca6b000982b5872384103a66d997fad4b093aab0`).
- **EVIDENCE**: screenshots in `repositories/liqd/plinko/evidence/` (E01, E02,
  E04, E05).
- **STANDARD**: the standard provably-fair construction used across the
  industry (commit to SHA-256 of a server seed; HMAC-SHA256 keyed by the server
  seed over `clientSeed:nonce:cursor`; bytes to integer).
- **DATA**: fixed by testing the standard candidates against the 10,100 live
  bets in `repositories/liqd/plinko/data/plinko-master-10100bets.json`
  (SHA-256 `871c485e…06fc95`, captured 7 Jul 2026 on `qa.liqd.com`, 202 epochs
  of 50 bets). The data chose; LIQD's code did not.

Unlike Duel, LIQD's pages name the primitive (HMAC-SHA256), the commitment and
the "count the rights" rule. The key form, message format, cursor base and bit
rule were settled by DATA.

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 32 lowercase hex characters (16 bytes); secret until the seed pair is rotated | PAGE: "Server Seed — Hidden Until Revealed. A random secret we generate for you. While it's in use you see only its hash." (`liqd.com/provably-fair`, read 2026-10-20T14:19Z). Form: DATA (all 202 revealed seeds and the pre-capture seed are 32 hex chars) |
| `clientSeed` | text string | PAGE: "Client Seed — Always Visible. Random by default, yours to change to anything." EVIDENCE E02: the default shown is 32 hex chars (`e1387c218cb4d548a84c67ea1fad893f`). DATA: capture seeds are 17 chars (`audit` + 12 hex, 9,600 bets) and 25 chars (`pfaudit-1783390325646-152` style, Phase D, 500 bets, 10 seeds) |
| `nonce` | non-negative integer, 0 on the first bet of a seed pair, +1 per bet | PAGE: "Nonce — Automatic. A simple counter that ticks up with every bet". EVIDENCE E02: "Total bets made with pair 0". DATA: all 202 epochs carry nonces exactly 0…49 |
| `rows` | integer 8…16 (`numberOfRows`) | PAGE: "Rows 8 to 16" (Game Info table, `liqd.com/originals/plinko`, read 2026-10-20T14:18Z) |
| `risk` | Low / Medium / High / WTF; `riskLevel` 1 / 2 / 3 / 4 | PAGE: "Risk levels Low, Medium, High, WTF"; "Select it and the row picker locks at 13". DATA: the id↔name mapping is fixed by the table match in §3 (10,100 / 10,100); every WTF bet is `riskLevel 4`, `numberOfRows 13` |
| `amount` | stake, decimal (`betAmount`, 8 dp string) | DATA (`0.10000000` × 9,900, `10.00000000` × 200) |

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
  → **202 / 202** bet hashes resolve, covering **10,100 / 10,100** bets;
  decoded-bytes form → **0 / 202**. The pre-capture seed also resolves.
- **Pair seeds to bets by hashing, not by record position.** In this capture
  each seed record's own `hashedServerSeed` equals the commitment of its own
  `serverSeed` (202 / 202), but an implementation should still look a bet's
  seed up by `commitment(seed) == bet.hashedServerSeed`.
- Forward chain: each record's `nextHashedServerSeed` equals the next record's
  `hashedServerSeed` on **201 / 201** transitions, and
  `meta.preCapture.nextHashedServerSeed` equals epoch 0's hash (pre-capture
  link). PAGE: "When you rotate … We hand over the old server seed in full, and
  a new one (already hashed) takes its place." EVIDENCE E02 shows "Active
  Server Seed (Hashed)" and a "Next Server Seed" field.

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

Example messages: `auditb1141320acde:0:1`, `auditb1141320acde:0:2`, …,
`auditb1141320acde:0:8` for an 8-row drop.

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
  first, on **10,100 / 10,100** bets; `winningSlot` equals `slot` on
  **10,100 / 10,100** (mirrored `rows − slot`: 1,169).
- SOURCE: PAGE ("Count the rights and you've got your bucket") + DATA. The page
  sentence implies bit 1 = a bounce to the right and slot 0 = the leftmost
  bucket; the data cannot check the screen direction because every table is
  symmetric (O2).

### Candidates tried (all on the full 10,100 bets)

"path" = whole `dropDetails` string equal; "slot" = `winningSlot` equal.

| Construction | path | slot |
|---|---|---|
| **key = hex-decoded seed; one HMAC per row, msg `c:n:r`, r = 1…rows; bit = u32 BE (first 4 bytes) mod 2** | **10,100** | **10,100** |
| same, r = 0…rows−1 | 3 | 5,060 (rows 1…rows−1 share bits, hence above chance) |
| same (r from 0 or 1), bit = u32 little-endian mod 2 | ≤ 8 | ≤ 1,571 |
| same (r from 0 or 1), bit = first byte ≥ 128 (≡ 4-byte float ≥ 0.5) | ≤ 10 | ≤ 1,633 |
| key = the 32-char ASCII seed; per-row HMAC, r from 0 or 1, each of the 3 bit rules | ≤ 8 | ≤ 1,655 |
| one byte stream from msg `c:n:cursor` (cursor from 0 or 1), consecutive 4-byte chunks per row, each of the 3 bit rules, either key form | ≤ 15 | ≤ 1,765 |
| single HMAC msg `c:n`, `c:n:0`, `c-n`, either key form, first `rows` bits of the digest MSB-first or LSB-first | ≤ 8 | ≤ 1,606 |

Wrong constructions with no shared bits scored 1,498–1,765 / 10,100 on slot
(two independent binomial draws on the same board coinciding) and near 0 on
the full path.

---

## 3. Win condition and payout

Plinko has no separate win/lose draw: every drop pays `amount × multiplier`,
where the multiplier depends only on `rows`, `risk` and `slot`.

### 3.1 Multiplier table

Read from the public game page's bucket strip (`liqd.com/originals/plinko`,
read logged out 2026-10-20T14:21Z by selecting each risk button and stepping
the Rows slider; saved in `page-reads-2026-10-20.json` → `boardLabels`).
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
  four outer buckets (`1k 235 235 1k`; E05 shows skull icons on the ten
  middle buckets); the page text gives the rest: "the ten middle buckets pay
  nothing and show a skull … The two buckets next to the edges pay 235x, the
  two outermost pay 1,000x", and the WTF table "Middle ten — Skull, 0x".
- Cross-checks: E01 (8/Low) and E04 (8/High) show the same labels; the page's
  "How The Boards Compare" table agrees on every edge and centre value it gives
  (Low 8 5.6x / 0.5x, Low 16 16x / 0.5x, Medium 8 13x / 0.4x, Medium 16 110x /
  0.3x, High 8 29x / 0.2x, High 16 1,000x / 0.2x). The page says "The three
  standard levels follow the industry-standard Plinko tables at 99% RTP, and
  WTF is the LIQD board."
- DATA: the served `multiplier` (and `coefficient`, equal on 10,100 / 10,100)
  equals `table[rows][risk][slot]` on **10,100 / 10,100** bets with
  `riskLevel` 1/2/3/4 = Low/Medium/High/WTF. The data exercises **285 of the
  365** cells; the other 80 rest on the page labels alone (O3).
- SOURCE: PAGE (values) + DATA (risk ids, exact agreement on exercised cells).

### 3.2 Payout and the `result` label

```
winningAmount = amount × multiplier            # exact decimal product, 8 dp string
result        = "won" if multiplier ≥ 1 else "lost"
```

- DATA: exact decimal product equals the served `winningAmount` on
  **10,100 / 10,100** (served with 8 decimals, e.g. `0.11000000`). With these
  stakes and ≤ 1-dp multipliers the product is exact, so no rounding or
  truncation rule is exercised (O4).
- DATA: `result` is `won` iff multiplier ≥ 1 on **10,100 / 10,100** (751 drops
  at exactly 1x are labelled `won`; 5,353 drops that paid back a non-zero amount
  under 1x are labelled `lost`). The label does not affect money.
- Exact RTP per config, `Σ C(rows,k)/2^rows × m_k`, ranges from **0.989062**
  (8/Medium) to **0.991602** (11/High) over the 28 configs; WTF/13 is
  0.989990. PAGE claims "99% on every board" and "House Edge 1%"; the game
  settings in every bet record carry `"houseEdge":1`. (Reported here as
  computed figures; the RTP-claim rule is applied by the audit, not by this
  spec.)
- SOURCE: STANDARD (stake × multiplier) + DATA.

### 3.3 Fields an implementation must not read

`dropDetails`, `winningSlot`, `multiplier`, `coefficient`, `winningAmount` and
`result` are the operator's claims, to be checked. `localPath`, `localSlot`
and `verified` are the capture script's own recomputation and must be ignored
(they were not used in writing this spec). The derivation reads only
`serverSeed`, `clientSeed`, `nonce`, `numberOfRows`, `riskLevel`, `betAmount`
and the §3.1 table.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE + EVIDENCE | `liqd.com/provably-fair` "Three Ingredients"; E02 |
| Rows 8–16, risk Low/Medium/High/WTF, WTF fixed at 13 | PAGE + DATA | Game Info table; WTF section; 2,000 WTF bets all rows 13 |
| Commitment = SHA-256 of the ASCII seed | PAGE + DATA | page example pair reproduces (ASCII only); 202/202 (decoded 0/202) |
| Forward chain | PAGE + DATA | 201/201 + pre-capture link |
| HMAC-SHA256 | PAGE | "Combined with HMAC-SHA256" |
| Key = hex-decoded seed, msg `clientSeed:nonce:r` | STANDARD + DATA | 10,100/10,100 path (ASCII key ≤ 8) |
| One HMAC per row, r = 1…rows | DATA | 10,100/10,100 (r from 0: path 3; streamed ≤ 15) |
| bit = first 4 bytes, big-endian u32, mod 2 | DATA | 10,100/10,100 (LE ≤ 8, byte ≥ 128 ≤ 10) |
| slot = number of 1-bits | PAGE + DATA | "Count the rights"; 10,100/10,100; mirrored 1,169 |
| multiplier = table[rows][risk][slot] | PAGE + DATA | board labels 20 Oct 2026; 10,100/10,100; 285/365 cells exercised |
| winningAmount = amount × multiplier | STANDARD + DATA | 10,100/10,100 exact |
| result = won iff multiplier ≥ 1 | DATA | 10,100/10,100 |

---

## 5. Test vectors (from the dataset)

Each vector is copied from `plinko-master-10100bets.json`; the server seed is
the revealed seed whose SHA-256 (of its ASCII text) equals the bet's
`hashedServerSeed`. `u32` is the first four bytes of `digest_r`, big-endian.
In all five, path, slot, multiplier and winningAmount equal the served
`dropDetails`, `winningSlot`, `multiplier` and `winningAmount`.

**V1: bet `SLOjmT9dyuUEi1que576R`** (Phase A, epoch 0, 8 rows, Low, nonce 0)
```
serverSeed  fc9a1d6fad00e0832fddfdea45435c85
commitment  3b34a0fce5732f2d9c89b16fca9c2b6a231c2b7f2de29bbc41e141861dc39d36
clientSeed  auditb1141320acde   nonce 0   rows 8   risk 1 (Low)   amount 0.10000000
digest_1 (msg "auditb1141320acde:0:1")
            1bc5cc26bf9ba6d661badc7907e87182fd2a3b9e3a9f4e183789cbd37d14db12
u32 r=1..8  465947686 261972339 3688591245 4099969822 3461456877 91014705 217623221 325826245
path        01101111   → slot 6
multiplier  1.1        winningAmount 0.11000000   result won
```

**V2: bet `xrCFhXxywfY7R9_O9gMLK`** (Phase B, epoch 113, 16 rows, High, the highest multiplier in Phase B)
```
serverSeed  ea78c284099479c0624dcc65bd49a6b4
commitment  4a20f49109bae29e360b795bb26ee9d2d1a41545cfd9e7db9d55c5291d4d752a
clientSeed  auditfdbdfd859cad   nonce 4   rows 16   risk 3 (High)   amount 0.10000000
digest_1 (msg "auditfdbdfd859cad:4:1")
            14a65daf28f097e59a986d398ba5c41975fc2c8ffb33c4c08e55e9e2d77e1939
u32 r=1..16 346447279 1187183741 504372685 2146127743 3132006485 4121536863 3580981619 1665279301
            3177010849 2445154865 2892111452 3238620967 1061105011 1168669417 1313618577 2487409767
path        1111111111011111   → slot 15
multiplier  130        winningAmount 13.00000000   result won
```

**V3: bet `9aCd3qGAlfwGyH6qMAxaO`** (Phase C, epoch 149, stake 10, 16 rows, High)
```
serverSeed  7946393604bd5d1a42972a32dcb34a6c
commitment  ac6291949101c6057cb6d48818b13229ee3085fb9877642c5c64118343cacf50
clientSeed  audit4235425fddbb   nonce 18   rows 16   risk 3 (High)   amount 10.00000000
digest_1 (msg "audit4235425fddbb:18:1")
            8f6617f7a56642a390b297adfb8cba0fdf324414a97b72a2bfe60b18f3db617d
u32 r=1..16 2405832695 842234661 2664265389 1239853252 555793299 1955308833 1660070429 700809953
            3925203730 3097751101 2464513283 3083207281 634065437 907262603 4272985791 1693099616
path        1110111101111110   → slot 13
multiplier  9          winningAmount 90.00000000   result won
```

**V4: bet `xQ1rdBH9y_ObcoopqpJYZ`** (Phase D, epoch 152, player-set client seed, 12 rows, Medium)
```
serverSeed  d7fc3e5d19db3e1646ffc5ec1da2bb9a
commitment  d36168fe4bd1110de73dd9bf67919c3f6c12414468f5fce7b811c90d5be9ac9a
clientSeed  pfaudit-1783390325646-152   nonce 13   rows 12   risk 2 (Medium)   amount 0.10000000
digest_1 (msg "pfaudit-1783390325646-152:13:1")
            b09c64f83793d74eff688e3cc48642d1d7f13edab56cccb64e5a5b876e724fdb
u32 r=1..12 2963039480 609955217 1753020910 2092186930 3168917280 4228365897 2546896041 408347392
            1501153080 100619428 1009938668 1422609502
path        010001100000   → slot 3
multiplier  2          winningAmount 0.20000000   result won
```

**V5: bet `2tGmOv7FZHfyCwhX7yCS3`** (Phase E, epoch 175, WTF, 13 rows, a 235x bucket)
```
serverSeed  0d249f81e03a903d6b17c71ebc82817a
commitment  1e74e08a9dd50f50ef689e15b52a37ca15c83fbcb1b166202a85f7ea78cec70b
clientSeed  auditc680c9435be0   nonce 32   rows 13   risk 4 (WTF)   amount 0.10000000
digest_1 (msg "auditc680c9435be0:32:1")
            a8a25bc36f1d2b339d641ada2ad3a1fa653ef6cbba4dd9ff9c2fa7a464b88450
u32 r=1..13 2829212611 3975601995 3693746059 345428137 2205473013 320649226 2045002243 2307408443
            2466660811 2056615533 5637941 1289934329 2014158041
path        1111101111111   → slot 12
multiplier  235        winningAmount 23.50000000   result won
```

---

## 6. Open points the public sources do not settle

- **O1: the byte-level recipe is not published.** The pages name HMAC-SHA256,
  the three inputs and "count the rights", but not the key form, the message
  separator, the cursor base (1), one digest per row, or the bit rule. Those
  rest on STANDARD + DATA. The provably-fair page has a "Technical
  Implementation" link and an in-page "Verify a Round" form; neither was opened
  (the first may show code; the form was not exercised), so no independent
  check against LIQD's own verifier was made.
- **O2: screen direction.** The page says the bucket is the count of rights,
  which reads as bit 1 = right and slot 0 = leftmost. All 28 tables are
  symmetric, so the data cannot confirm the direction, and which cursor is the
  top row is not visible in the data either. Neither affects the multiplier.
- **O3: 80 of 365 table cells are page-only.** The edge buckets that the live
  sample never hit (e.g. High/16 slots 0 and 16, WTF slots 0 and 13) rest on
  the 20 Oct 2026 board labels and page text, not on a paid bet. The labels
  were read on `liqd.com` on 20 Oct 2026; the bets were placed on `qa.liqd.com`
  on 7 Jul 2026. They agree on all 285 exercised cells, but no table from
  7 Jul and no machine-readable config was read. A strip label could in
  principle be a rounding of a longer value; on every exercised cell it was
  exact.
- **O4: rounding, caps and limits.** Every product in the data is exact at
  ≤ 3 dp, so no rounding or truncation rule is witnessed. Each bet's
  `currentGameSettings` carries `"minBet":0.1,"maxBet":62500,"maxProfit":250000,
  "minOdds":1.01,"maxOdds":10000,"houseEdge":1`; whether `maxProfit` caps a
  payout is not exercised (largest payout in the data: 90, V3). The live page
  says "Min Bet 0.01 USDC equivalent", the July qa settings say 0.1.
- **O5: client-seed encoding beyond ASCII.** UTF-8 is the assumption; all
  captured client seeds are ASCII.
- **O6: RTP figures vs the 99% claim.** The exact per-config RTP of the page
  table runs 0.989062–0.991602 (§3.2) against "99% on every board". This spec
  records the figures; the RTP-claim check belongs to the audit.

---

## 7. Reproduction of this spec

The spec was implemented, independently of any audit package, in a throwaway
script (`spec_check.py`, outside the repo, reading only the dataset and the
saved board labels) and run on every bet:

```
preCapture: SHA256(ascii revealedServerSeed) == hashedServerSeed: True
commitment SHA256(ascii serverSeed) resolves 202/202 bet hashes, covering 10100/10100 bets
  (SHA256(hex-decoded bytes): 0/202)
  seed records whose own hashedServerSeed == commitment(own serverSeed): 202/202
path: bit_r = u32BE(HMAC-SHA256(key=hexdecode(serverSeed), "clientSeed:nonce:r")[0:4]) mod 2, r=1..rows; string == dropDetails: 10100/10100  mismatches=[]
slot = number of 1-bits == winningSlot: 10100/10100  (mirrored rows-sum: 1169/10100)
served multiplier == page board label table[rows][risk][slot] (1k=1000, WTF middle ten=0): 10100/10100
table cells exercised by the data: 285/365
winningAmount == betAmount x table multiplier (exact decimal): 10100/10100
result == "won" iff multiplier >= 1: 10100/10100
exact RTP over 28 configs: min 0.989062 at (8, 2), max 0.991602 at (11, 3)
symmetric tables: 28 / 28
```

Forward chain (`payout.py`, same directory):

```
forward chain nextHashedServerSeed[k] == hashedServerSeed[k+1]: 201/201
preCapture.nextHashedServerSeed == epoch0 hashedServerSeed: True
epochs with nonces exactly 0..49: 202 / 202
```

The candidate sweep (`sweep.py`) printed one line per construction; the
§2 table quotes its best scores per family.

---

## 8. Files and pages read while writing this spec

Read: `repositories/liqd/plinko/evidence/` E01-plinko-game-ui.png,
E02-provably-fair-panel.png, E04-multiplier-tables.jpg, E05-wtf-mode.jpg,
rtp-page-labels-2026-10-01.json; `repositories/liqd/plinko/data/plinko-master-10100bets.json`;
the framework spec folder's `games/plinko/profile.json`;
`games/plinko/ALGORITHM.md` and
`games/dice/ALGORITHM.md` (Duel specs, models of shape). Live pages, logged
out, GET only, rendered in a fresh browser context on 20 Oct 2026:
`https://liqd.com/originals/plinko` (page text, meta description, and the
bucket-strip labels for every rows/risk, read by clicking the risk buttons and
moving the Rows slider; no bet, nothing typed) and
`https://liqd.com/provably-fair` (page text). Plain `curl` GETs of
`liqd.com/originals/plinko`, `liqd.com/provably-fair` and `qa.liqd.com/`
returned 403.

Not opened: `src/`, `tests/`, `scripts/`, `capture/`, `outputs/`,
`verifier-parity/`, `verify.js`, `test.js`, `replay.js`, `plinkoConfig.json`,
`MANIFEST.md`, `README.md`, `AUDIT_CONTEXT.md` or `workshop-notes/` of any LIQD
package; anything named `verify-tab`; any LIQD JS bundle; the auditor's other LIQD working folders;
the browser tool's snapshot folder; LIQD's in-game Verify tab; the provably-fair page's
"Technical Implementation" section.
