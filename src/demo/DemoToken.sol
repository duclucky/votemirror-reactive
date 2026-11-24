// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";
import { Time } from "@openzeppelin/contracts/utils/types/Time.sol";

/// @title DemoToken
/// @notice Valueless governance token for the VoteMirror demo. Anyone can mint from the faucet.
/// @dev Uses a timestamp clock: Base Sepolia blocks are far too fast to count time in blocks.
contract DemoToken is ERC20, ERC20Permit, ERC20Votes {
    uint256 public constant FAUCET_AMOUNT = 1_000e18;

    constructor() ERC20("VoteMirror Demo Token", "VMD") ERC20Permit("VoteMirror Demo Token") { }

    /// @notice Mints `FAUCET_AMOUNT` demo tokens to `to_`.
    function faucet(address to_) external {
        _mint(to_, FAUCET_AMOUNT);
    }

    function clock() public view override returns (uint48) {
        return Time.timestamp();
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    function _update(address from_, address to_, uint256 value_) internal override(ERC20, ERC20Votes) {
        super._update(from_, to_, value_);
    }

    function nonces(address owner_) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner_);
    }
}
