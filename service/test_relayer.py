import json
from pathlib import Path
import tempfile
import unittest

from relayer import Relayer, Rpc, RpcError


class FakeSigner:
    def __init__(self):
        self.signed = []

    def calldata(self, signature, *args):
        return json.dumps([signature, args])

    def decode(self, signature, data):
        return data

    def sign(self, destination, data, nonce, gas, price):
        self.signed.append((nonce, price))
        return dict(raw=f"signed-{nonce}-{price}", hash=f"hash-{nonce}-{price}", price=price)


class FakeRpc:
    def __init__(self):
        self.sent = []
        self.receipts = {}
        self.voted = False
        self.paused = False
        self.nonce = 0
        self.submit_succeeds = True
        self.journal = None

    def read(self, method, params):
        if method == "eth_call":
            signature, args = json.loads(params[0]["data"])
            if signature == "paused()":
                return [self.paused]
            if signature == "recoveryProposals()":
                return [[123]]
            if signature == "state(uint256)":
                return [1]
            if signature == "hasVoted(uint256,address)":
                return [self.voted]
            if signature == "skipped(uint256)":
                return [False]
            if signature == "confirmedSupport(uint256)":
                return [True, 1]
        if method == "eth_estimateGas":
            return hex(100)
        if method == "eth_gasPrice":
            return hex(5)
        if method == "eth_getBalance":
            return hex(10**18)
        if method == "eth_getTransactionCount":
            return hex(self.nonce)
        if method == "eth_getTransactionReceipt":
            return self.receipts.get(params[0])
        if method == "eth_getBlockByNumber":
            return dict(hash="canonical")
        if method == "eth_blockNumber":
            return hex(20)
        raise AssertionError((method, params))

    def broadcast(self, raw):
        # Losing the process after the remote node accepted this send must not
        # erase the signature or cause a second nonce to be allocated.
        assert json.loads(self.journal.read_text())["pending"]["candidates"][-1]["raw"] == raw
        self.sent.append(raw)
        return self.submit_succeeds


class RelayerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.now = 1_800_000_000
        self.config = dict(chain=84532, mirror="mirror", governor="governor", sender="sender",
                           daily_budget_wei=10**12, max_gas=900_000, max_price_wei=1000,
                           replacement_seconds=90, confirmations=2)
        self.rpc = FakeRpc()
        self.rpc.journal = self.directory / "journal.json"
        self.signer = FakeSigner()
        self.service = self.make()

    def make(self):
        return Relayer(self.config, self.directory, self.rpc, self.signer, lambda: self.now)

    def mine(self, candidate, voted=True, canonical=True):
        self.rpc.receipts[candidate["hash"]] = dict(
            blockNumber=hex(10), blockHash="canonical" if canonical else "orphan",
            gasUsed=hex(100), effectiveGasPrice=hex(candidate["price"]), status="0x1",
        )
        self.rpc.voted = voted
        self.rpc.nonce = 1

    def test_broadcast_failure_and_restart_reuse_identical_signed_transaction(self):
        self.rpc.submit_succeeds = False
        self.assertEqual(self.service.tick(), "submitted")
        self.assertEqual(len(self.signer.signed), 1)
        restarted = self.make()
        self.assertEqual(restarted.tick(), "pending")
        self.assertEqual(self.rpc.sent[0], self.rpc.sent[1])
        self.assertEqual(len(self.signer.signed), 1)

    def test_replacement_uses_same_nonce_and_accepts_original_receipt(self):
        self.service.tick()
        original = self.service.state["pending"]["candidates"][0]
        self.now += 91
        self.service.tick()
        self.assertEqual([n for n, _ in self.signer.signed], [0, 0])
        self.assertGreater(self.signer.signed[1][1], self.signer.signed[0][1])
        self.mine(original)
        self.assertEqual(self.service.tick(), "vote_confirmed")
        self.assertIsNone(self.service.state["pending"])
        self.assertEqual(self.service.state["spent"][self.service.day()], 1000)
        self.assertEqual(self.service.tick(), "caught_up")

    def test_receipt_success_without_vote_stays_retryable(self):
        self.service.tick()
        self.mine(self.service.state["pending"]["candidates"][0], voted=False)
        self.assertEqual(self.service.tick(), "retry_after_receipt")
        self.service.tick()
        self.assertEqual(self.signer.signed[-1][0], 1)

    def test_orphan_receipt_does_not_count_as_completed(self):
        self.service.tick()
        self.mine(self.service.state["pending"]["candidates"][0], canonical=False)
        self.assertEqual(self.service.tick(), "nonce_attention")
        self.assertEqual(self.service.state["receipts"], [])

    def test_pause_and_daily_budget_prevent_signing(self):
        self.rpc.paused = True
        self.assertEqual(self.service.tick(), "paused")
        self.rpc.paused = False
        self.config["daily_budget_wei"] = 1
        self.assertEqual(self.service.tick(), "daily_budget")
        self.assertEqual(self.signer.signed, [])

    def test_unexplained_nonce_does_not_create_another_transaction(self):
        self.service.tick()
        self.rpc.nonce = 7
        self.assertEqual(self.service.tick(), "nonce_attention")
        self.assertEqual(len(self.signer.signed), 1)

    def test_journal_cannot_be_reused_for_another_contract(self):
        self.service.save()
        self.config["mirror"] = "other"
        with self.assertRaises(RuntimeError):
            self.make()

    def test_receipt_accounting_waits_for_vote_state_read(self):
        self.service.tick()
        candidate = self.service.state["pending"]["candidates"][0]
        self.mine(candidate)
        original_read = self.rpc.read

        def unavailable_vote(method, params):
            if method == "eth_call" and "hasVoted" in params[0]["data"]:
                raise RpcError("temporary outage")
            return original_read(method, params)

        self.rpc.read = unavailable_vote
        with self.assertRaises(RpcError):
            self.service.tick()
        self.assertEqual(self.service.state["spent"], {})
        self.rpc.read = original_read
        self.assertEqual(self.service.tick(), "vote_confirmed")
        self.assertEqual(self.service.state["spent"][self.service.day()], 1000)

    def test_l1_fee_is_included_in_confirmed_spend(self):
        self.service.tick()
        candidate = self.service.state["pending"]["candidates"][0]
        self.mine(candidate)
        self.rpc.receipts[candidate["hash"]]["l1Fee"] = hex(123)
        self.service.tick()
        self.assertEqual(self.service.state["spent"][self.service.day()], 1123)

    def test_l1_reserve_is_included_before_signing(self):
        self.config["l1_fee_reserve_wei"] = 10**12
        self.assertEqual(self.service.tick(), "daily_budget")
        self.assertEqual(self.signer.signed, [])


class RpcTest(unittest.TestCase):
    def test_transport_failure_and_wrong_chain_are_skipped(self):
        class Endpoints(Rpc):
            def at(self, url, method, params):
                if url == "offline":
                    raise OSError()
                if method == "eth_chainId":
                    return hex(1 if url == "wrong-chain" else 84532)
                return "answer"
        rpc = Endpoints(["offline", "wrong-chain", "working"], 84532)
        self.assertEqual(rpc.read("eth_getBalance", ["wallet", "latest"]), "answer")
        self.assertTrue(rpc.broadcast("signed"))

    def test_receipt_not_seen_on_first_rpc_is_searched_on_next(self):
        class Endpoints(Rpc):
            def at(self, url, method, params):
                if method == "eth_chainId":
                    return hex(84532)
                return None if url == "lagging" else {"transactionHash": "known"}
        rpc = Endpoints(["lagging", "current"], 84532)
        self.assertEqual(rpc.read("eth_getTransactionReceipt", ["known"]),
                         {"transactionHash": "known"})


if __name__ == "__main__":
    unittest.main()
