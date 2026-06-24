// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984Restricted} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984Restricted.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {AttestationRegistry} from "./AttestationRegistry.sol";

/// @title CompliantConfidentialToken (cUSD)
/// @notice An ERC-7984 confidential stablecoin whose balances and transfer amounts are encrypted
///         (`euint64`), with KYC/compliance gating layered on the *plaintext* sender/recipient
///         addresses. Used as the payment rail for Aegis payroll/vendor disbursements.
/// @dev Compliance model (two independent gates, both enforced in {ERC7984Restricted-_update}):
///        1. ALLOWLIST  — {canTransact} requires a valid attestation in {AttestationRegistry}.
///        2. BLOCKLIST  — the owner can additionally freeze a specific account ({setFrozen}).
///      You CANNOT gate on an encrypted attribute: addresses are public, amounts are private, so
///      gating happens on the plaintext counterparties exactly as a regulator would expect.
///
///      ⚠️ CENSORSHIP NOTE (ethskills CROPS): {setFrozen} lets a single owner key block an account
///      from sending/receiving. That is a deliberate compliance control but also a censorship
///      vector. In production, transfer ownership to a multisig/timelock. Documented in README.
contract CompliantConfidentialToken is ERC7984Restricted, ZamaEthereumConfig, Ownable2Step {
    AttestationRegistry public immutable registry;

    event Minted(address indexed to, uint64 amount);
    event FrozenSet(address indexed account, bool frozen);

    error ZeroAddress();

    /// @param name_ Token name (e.g. "Compliant USD").
    /// @param symbol_ Token symbol (e.g. "cUSD").
    /// @param uri_ Contract metadata URI.
    /// @param registry_ The attestation registry that drives the allowlist.
    /// @param initialOwner The token owner (treasury / issuer).
    constructor(
        string memory name_,
        string memory symbol_,
        string memory uri_,
        AttestationRegistry registry_,
        address initialOwner
    ) ERC7984(name_, symbol_, uri_) Ownable(initialOwner) {
        if (address(registry_) == address(0) || initialOwner == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    /// @notice Allowlist gate: an account may send/receive only if it holds a valid attestation AND
    ///         has not been explicitly frozen (BLOCKED) by the owner.
    /// @dev Overrides the default {ERC7984Restricted} blocklist semantics into an allowlist.
    function canTransact(address account) public view virtual override returns (bool) {
        return registry.isVerified(account) && getRestriction(account) != Restriction.BLOCKED;
    }

    /// @notice Owner faucet: mint `amount` (6-decimal base units) of cUSD to a verified `to`.
    /// @dev `to` must be allowlisted (mint is checked as a recipient in {_update}).
    function mint(address to, uint64 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        euint64 amt = FHE.asEuint64(amount);
        FHE.allowThis(amt);
        _mint(to, amt);
        emit Minted(to, amount);
    }

    /// @notice Mint an encrypted amount (the cleartext is never revealed on-chain).
    function mintEncrypted(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        euint64 amt = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(amt);
        _mint(to, amt);
        emit Minted(to, 0);
    }

    /// @notice Owner compliance control: freeze/unfreeze an account (BLOCKED overrides the allowlist).
    /// @dev ⚠️ Censorship vector — see contract-level note. Intended for sanctions/fraud response.
    function setFrozen(address account, bool frozen) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (frozen) {
            _blockUser(account);
        } else {
            _resetUser(account);
        }
        emit FrozenSet(account, frozen);
    }

    /// @notice Convenience view: whether `account` is currently frozen by the owner.
    function isFrozen(address account) external view returns (bool) {
        return getRestriction(account) == Restriction.BLOCKED;
    }
}
