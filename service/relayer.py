"""VoteMirror's fee-funded, permissionless Base recovery sender.

No owner key is required. Signed transactions are persisted before broadcast and
reused verbatim across RPC failover and process restarts.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request


class RpcError(Exception):
    pass


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


class Rpc:
    def __init__(self, urls, chain):
        self.urls = urls
        self.chain = chain

    def at(self, url, method, params):
        request = urllib.request.Request(
            url, json.dumps(dict(jsonrpc="2.0", id=1, method=method, params=params)).encode(),
            {"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            answer = json.load(response)
        if "error" in answer:
            raise RpcError("RPC rejected request")
        return answer["result"]

    def read(self, method, params):
        receipt_not_seen = False
        for url in self.urls:
            try:
                if int(self.at(url, "eth_chainId", []), 16) != self.chain:
                    continue
                result = self.at(url, method, params)
                if method == "eth_getTransactionReceipt" and result is None:
                    receipt_not_seen = True
                    continue
                return result
            except (OSError, ValueError, RpcError):
                continue
        if receipt_not_seen:
            return None
        raise RpcError("All configured RPCs unavailable")

    def broadcast(self, raw):
        # Each endpoint receives the identical signed transaction. A timeout never
        # authorizes a different nonce or an independent transfer.
        accepted = False
        for url in self.urls:
            try:
                if int(self.at(url, "eth_chainId", []), 16) == self.chain:
                    self.at(url, "eth_sendRawTransaction", [raw])
                    accepted = True
            except (OSError, ValueError, RpcError):
                continue
        return accepted


class Cast:
    def __init__(self, executable, keystore, password_file, chain):
        self.executable = executable
        self.keystore = keystore
        self.password_file = password_file
        self.chain = chain

    def run(self, *arguments):
        result = subprocess.run(
            [self.executable, *arguments], capture_output=True, text=True, timeout=30,
        )
        if result.returncode:
            raise RuntimeError("Cast command failed")
        return result.stdout.strip()

    def calldata(self, signature, *args):
        return self.run("calldata", signature, *map(str, args))

    def decode(self, signature, data):
        return json.loads(self.run("decode-abi", "--json", signature, data))

    def sign(self, destination, data, nonce, gas, price):
        raw = self.run(
            "mktx", destination, data, "--legacy", "--chain", str(self.chain),
            "--nonce", str(nonce), "--gas-limit", str(gas), "--gas-price", str(price),
            "--keystore", self.keystore, "--password-file", self.password_file,
        )
        return dict(raw=raw, hash=self.run("keccak", raw), price=price)


class Relayer:
    def __init__(self, config, directory, rpc, signer, clock=time.time):
        self.config = config
        self.directory = Path(directory)
        self.rpc = rpc
        self.signer = signer
        self.clock = clock
        self.path = self.directory / "journal.json"
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {
            "chain": config["chain"], "mirror": config["mirror"],
            "sender": config["sender"], "spent": {}, "receipts": [], "pending": None,
        }
        for field in ("chain", "mirror", "sender"):
            if self.state[field] != config[field]:
                raise RuntimeError("Journal belongs to another deployment or signer")

    def save(self):
        write_json(self.path, self.state)

    def day(self):
        return datetime.datetime.fromtimestamp(
            self.clock(), datetime.timezone.utc,
        ).strftime("%Y-%m-%d")

    def view(self, target, signature, *args):
        input_signature = signature.split(")", 1)[0] + ")"
        data = self.signer.calldata(input_signature, *args)
        result = self.rpc.read("eth_call", [dict(to=target, data=data), "latest"])
        return self.signer.decode(signature, result)

    def within_budget(self, gas, price):
        spent = self.state["spent"].get(self.day(), 0)
        reserve = self.config.get("l1_fee_reserve_wei", 0)
        return spent + gas * price + reserve <= self.config["daily_budget_wei"]

    def tick(self):
        if self.state["pending"]:
            return self.deliver_pending()
        if self.view(self.config["mirror"], "paused()(bool)")[0]:
            return "paused"
        proposals = self.view(
            self.config["governor"], "recoveryProposals()(uint256[])",
        )[0]
        if len(proposals) > 32:
            raise RuntimeError("Unbounded proposal registry")
        for proposal in proposals:
            proposal = int(proposal)
            if int(self.view(self.config["governor"], "state(uint256)(uint8)", proposal)[0]) != 1:
                continue
            if self.view(self.config["governor"], "hasVoted(uint256,address)(bool)",
                         proposal, self.config["mirror"])[0]:
                continue
            if self.view(self.config["mirror"], "skipped(uint256)(bool)", proposal)[0]:
                continue
            if not self.view(self.config["mirror"], "confirmedSupport(uint256)(bool,uint8)", proposal)[0]:
                continue
            data = self.signer.calldata("reconcileProposal(uint256)", proposal)
            transaction = dict(to=self.config["mirror"], data=data, **{"from": self.config["sender"]})
            estimate = int(self.rpc.read("eth_estimateGas", [transaction]), 16)
            gas = estimate * 12 // 10 + 10_000
            price = max(1, int(self.rpc.read("eth_gasPrice", []), 16) * 2)
            if gas > self.config["max_gas"] or price > self.config["max_price_wei"]:
                return "gas_limit"
            if not self.within_budget(gas, price):
                return "daily_budget"
            balance = int(self.rpc.read("eth_getBalance", [self.config["sender"], "latest"]), 16)
            if balance < gas * price + self.config.get("l1_fee_reserve_wei", 0):
                return "needs_funding"
            nonce = int(self.rpc.read("eth_getTransactionCount", [self.config["sender"], "pending"]), 16)
            signed = self.signer.sign(self.config["mirror"], data, nonce, gas, price)
            self.state["pending"] = dict(
                proposal=str(proposal), nonce=nonce, gas=gas, data=data,
                candidates=[signed], last_signed=self.clock(),
            )
            self.save()
            # The signature, nonce and hash are durable before any network send.
            self.rpc.broadcast(signed["raw"])
            return "submitted"
        return "caught_up"

    def deliver_pending(self):
        pending = self.state["pending"]
        for candidate in pending["candidates"]:
            receipt = self.rpc.read("eth_getTransactionReceipt", [candidate["hash"]])
            if not receipt:
                continue
            block = self.rpc.read("eth_getBlockByNumber", [receipt["blockNumber"], False])
            if not block or block["hash"] != receipt["blockHash"]:
                continue
            head = int(self.rpc.read("eth_blockNumber", []), 16)
            if head - int(receipt["blockNumber"], 16) < self.config["confirmations"]:
                return "confirming"
            execution_cost = int(receipt["gasUsed"], 16) * int(receipt["effectiveGasPrice"], 16)
            l1_fee = int(receipt.get("l1Fee", "0x0"), 16)
            cost = execution_cost + l1_fee
            voted = self.view(
                self.config["governor"], "hasVoted(uint256,address)(bool)",
                pending["proposal"], self.config["mirror"],
            )[0]
            # Do not mutate accounting until all reads above succeeded. An RPC
            # outage must not charge the same receipt twice on the next tick.
            day = self.day()
            self.state["spent"][day] = self.state["spent"].get(day, 0) + cost
            self.state["receipts"].append(dict(
                hash=candidate["hash"], proposal=pending["proposal"], cost=cost,
                execution_cost=execution_cost, l1_fee=l1_fee,
                status=receipt["status"], block=receipt["blockNumber"], vote_confirmed=bool(voted),
            ))
            self.state["receipts"] = self.state["receipts"][-1000:]
            self.state["pending"] = None
            self.save()
            return "vote_confirmed" if voted else "retry_after_receipt"
        latest_nonce = int(self.rpc.read(
            "eth_getTransactionCount", [self.config["sender"], "latest"],
        ), 16)
        if latest_nonce > pending["nonce"]:
            # A private signer must be exclusive to this service. Never skip an
            # unexplained nonce: another RPC may still hold the receipt we need.
            return "nonce_attention"
        candidate = pending["candidates"][-1]
        if self.clock() - pending["last_signed"] >= self.config["replacement_seconds"]:
            price = max(candidate["price"] * 113 // 100 + 1,
                        int(self.rpc.read("eth_gasPrice", []), 16) * 2)
            if price <= self.config["max_price_wei"] and self.within_budget(pending["gas"], price):
                candidate = self.signer.sign(
                    self.config["mirror"], pending["data"], pending["nonce"], pending["gas"], price,
                )
                pending["candidates"].append(candidate)
                pending["last_signed"] = self.clock()
                self.save()
        self.rpc.broadcast(candidate["raw"])
        return "pending"


def run(config_path, directory, password_file, once=False):
    config = json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    # The OS releases this lock if the process crashes. Restarting never creates
    # a second nonce allocator while the original process is alive.
    with (directory / "sender.lock").open("a+b") as lock:
        lock.seek(0)
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        signer = Cast(config["cast"], config["keystore"], password_file, config["chain"])
        rpc = Rpc(config["rpcs"], config["chain"])
        service = Relayer(config, directory, rpc, signer)
        while True:
            health = dict(timestamp=int(time.time()), pid=os.getpid())
            try:
                health["status"] = service.tick()
                health["pending"] = bool(service.state["pending"])
                health["confirmed_transactions"] = len(service.state["receipts"])
            except Exception as error:
                health["status"] = "retrying"
                health["error_type"] = type(error).__name__
            write_json(directory / "health.json", health)
            if once:
                return health
            time.sleep(config["poll_seconds"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--password-file", required=True)
    parser.add_argument("--once", action="store_true")
    arguments = parser.parse_args()
    run(arguments.config, arguments.directory, arguments.password_file, arguments.once)
