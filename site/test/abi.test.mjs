import test from "node:test";
import assert from "node:assert/strict";
import * as abi from "../js/abi.js";

test("keccak256 matches known vectors", () => {
  assert.equal(abi.keccak256(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(
    abi.topic("VoteCast(address,uint256,uint8,uint256,string)"),
    "0xb8e138887d0aa13bab447e82de9d5c1777041ecd21ca36ba824ff1e6c07ddda4",
  );
  // Longer than one 136-byte block.
  assert.equal(
    abi.keccak256("a".repeat(200)),
    "0x96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d",
  );
  assert.equal(abi.selector("recordedVote(uint256,address)"), "0x7870be83");
  assert.equal(abi.selector("trustedVoters()"), "0x4124261f");
});

test("checksum produces EIP-55 addresses", () => {
  assert.equal(
    abi.checksum("0x7266da930e9adb5f028c09991275b0d88744f194"),
    "0x7266da930e9aDb5F028c09991275b0d88744F194",
  );
  assert.equal(
    abi.checksum("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"),
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  );
});

test("decodes words, strings and address arrays", () => {
  const data =
    "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "000000000000000000000000693a59c704615b121752804fb70a8fa3af210306" +
    "00000000000000000000000065165d1632b58de4f095ae94bd5d957592beb52e";
  assert.deepEqual(abi.addressArray(data, 0), [
    "0x693a59C704615b121752804fB70a8fA3Af210306",
    "0x65165D1632B58DE4f095AE94BD5D957592beB52e",
  ]);
  const text =
    "0x" +
    "0000000000000000000000000000000000000000000000000000000000000020" +
    "0000000000000000000000000000000000000000000000000000000000000003" +
    "56c3a40000000000000000000000000000000000000000000000000000000000";
  assert.equal(abi.string(text, 0), "V\u00e4");
  assert.throws(() => abi.word("0x00", 0));
});

test("encodeCall pads static arguments", () => {
  assert.equal(
    abi.encodeCall("recordedVote(uint256,address)", [5n, "0x693a59C704615b121752804fB70a8fA3Af210306"]),
    "0x7870be83" +
      "0000000000000000000000000000000000000000000000000000000000000005" +
      "000000000000000000000000693a59c704615b121752804fb70a8fa3af210306",
  );
});
