// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title AttestationRegistry
/// @notice Minimal on-chain KYC / compliance attestation registry. Stands in for a production
///         attestation provider (e.g. EAS, Zentity, AttestRail). A set of authorized attesters
///         mark accounts as verified, optionally with an expiry and an ISO-3166 numeric country
///         code. `CompliantConfidentialToken` reads {isVerified} to gate confidential transfers.
/// @dev This registry holds NO encrypted data and moves NO value — it is a public allowlist of
///      plaintext addresses. Address-level KYC is deliberately public; only payment *amounts* are
///      encrypted (by the token/vault). See the project README "What is and isn't private".
contract AttestationRegistry is Ownable2Step {
    struct Attestation {
        bool active; // currently verified
        uint64 validUntil; // unix seconds; 0 == no expiry
        uint16 countryCode; // ISO-3166-1 numeric (0 == unspecified)
    }

    mapping(address account => Attestation) private _attestations;
    mapping(address attester => bool) private _attesters;

    event Attested(address indexed account, uint64 validUntil, uint16 countryCode, address indexed attester);
    event Revoked(address indexed account, address indexed attester);
    event AttesterSet(address indexed attester, bool allowed);

    error NotAttester(address caller);
    error ZeroAddress();

    modifier onlyAttester() {
        if (!_attesters[msg.sender]) revert NotAttester(msg.sender);
        _;
    }

    /// @param initialOwner The owner, who manages the attester set. The owner is itself the first attester.
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        _attesters[initialOwner] = true;
        emit AttesterSet(initialOwner, true);
    }

    /// @notice Authorize or de-authorize an attester (e.g. an off-chain KYC provider's signing key).
    function setAttester(address attester, bool allowed) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        _attesters[attester] = allowed;
        emit AttesterSet(attester, allowed);
    }

    /// @notice Attest that `account` has passed KYC.
    /// @param account The account being attested.
    /// @param validUntil Unix expiry (0 for no expiry).
    /// @param countryCode ISO-3166-1 numeric country code (0 if unspecified).
    function attest(address account, uint64 validUntil, uint16 countryCode) external onlyAttester {
        if (account == address(0)) revert ZeroAddress();
        _attestations[account] = Attestation({active: true, validUntil: validUntil, countryCode: countryCode});
        emit Attested(account, validUntil, countryCode, msg.sender);
    }

    /// @notice Revoke an existing attestation.
    function revoke(address account) external onlyAttester {
        if (account == address(0)) revert ZeroAddress();
        delete _attestations[account];
        emit Revoked(account, msg.sender);
    }

    /// @notice Whether `account` currently holds a valid, unexpired attestation.
    function isVerified(address account) public view returns (bool) {
        Attestation memory a = _attestations[account];
        return a.active && (a.validUntil == 0 || block.timestamp <= a.validUntil);
    }

    /// @notice Full attestation record for `account`.
    function attestationOf(address account) external view returns (Attestation memory) {
        return _attestations[account];
    }

    /// @notice Whether `attester` is an authorized attester.
    function isAttester(address attester) external view returns (bool) {
        return _attesters[attester];
    }
}
