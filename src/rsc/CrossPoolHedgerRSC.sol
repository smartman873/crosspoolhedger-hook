// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AbstractReactive} from "reactive-lib/abstract-base/AbstractReactive.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {ICrossPoolHedger} from "../interfaces/ICrossPoolHedger.sol";
import {ExposureMath} from "../libraries/ExposureMath.sol";

contract CrossPoolHedgerRSC is IReactive, AbstractReactive {
    error SubscriptionFailed();
    error OnlySubscriptionAdmin();

    uint256 public immutable ORIGIN_CHAIN_ID;
    uint256 public immutable DESTINATION_CHAIN_ID;
    address public immutable HOOK_ADDRESS;
    bytes32 public immutable POOL_A_ID;
    bytes32 public immutable POOL_B_ID;
    uint64 public immutable CALLBACK_GAS_LIMIT;
    address public immutable SUBSCRIPTION_ADMIN;
    address public immutable CALLBACK_SENDER;

    uint256 public constant POOL_EXPOSURE_UPDATE_TOPIC =
        uint256(keccak256("PoolExposureUpdate(bytes32,int256,int256,uint256)"));

    int256 public hedgeThreshold;
    uint256 public cooldownBlocks;
    int256 public netExposureA;
    int256 public netExposureB;
    int256 public lastImbalance;
    uint256 public lastHedgeBlock;
    bool public subscriptionConfigured;

    mapping(bytes32 => bool) public callbackQueued;

    event SubscriptionConfigured(uint256 indexed chainId, address indexed hook, uint256 topic0);
    event SubscriptionUnavailable();
    event ExposureObserved(bytes32 indexed poolId, int256 netExposure, int256 combinedImbalance, uint256 blockNumber);
    event HedgeCallbackQueued(bytes32 indexed targetPoolId, int256 swapAmount, int256 imbalance);

    modifier onlySubscriptionAdmin() {
        if (msg.sender != SUBSCRIPTION_ADMIN) revert OnlySubscriptionAdmin();
        _;
    }

    constructor(
        uint256 originChainId,
        uint256 destinationChainId,
        address hookAddress,
        bytes32 poolAId,
        bytes32 poolBId,
        int256 hedgeThreshold_,
        uint256 cooldownBlocks_,
        uint64 callbackGasLimit
    ) payable {
        ORIGIN_CHAIN_ID = originChainId;
        DESTINATION_CHAIN_ID = destinationChainId;
        HOOK_ADDRESS = hookAddress;
        POOL_A_ID = poolAId;
        POOL_B_ID = poolBId;
        hedgeThreshold = hedgeThreshold_;
        cooldownBlocks = cooldownBlocks_;
        CALLBACK_GAS_LIMIT = callbackGasLimit;
        SUBSCRIPTION_ADMIN = msg.sender;
        CALLBACK_SENDER = msg.sender;
        _configureSubscription(false);
    }

    function configureSubscription() external onlySubscriptionAdmin {
        if (subscriptionConfigured) return;
        _configureSubscription(true);
    }

    function react(LogRecord calldata log) external vmOnly {
        if (
            log.chain_id != ORIGIN_CHAIN_ID || log._contract != HOOK_ADDRESS
                || log.topic_0 != POOL_EXPOSURE_UPDATE_TOPIC
        ) {
            return;
        }

        bytes32 poolId = bytes32(log.topic_1);
        (int256 poolNetExposure, int256 combinedImbalance, uint256 eventBlock) =
            abi.decode(log.data, (int256, int256, uint256));

        if (poolId == POOL_A_ID) {
            netExposureA = poolNetExposure;
        } else if (poolId == POOL_B_ID) {
            netExposureB = poolNetExposure;
        } else {
            return;
        }

        int256 currentImbalance = netExposureA + netExposureB;
        if (combinedImbalance != currentImbalance) {
            combinedImbalance = currentImbalance;
        }
        lastImbalance = currentImbalance;
        emit ExposureObserved(poolId, poolNetExposure, currentImbalance, eventBlock);

        bool thresholdBreached = ExposureMath.abs(currentImbalance) > ExposureMath.abs(hedgeThreshold);
        bool cooldownElapsed = lastHedgeBlock == 0 || eventBlock > lastHedgeBlock + cooldownBlocks;
        if (!thresholdBreached || !cooldownElapsed || callbackQueued[poolId]) return;

        (bytes32 targetPoolId, int256 swapAmount) = _computeHedgeParams(currentImbalance);
        lastHedgeBlock = eventBlock;
        callbackQueued[poolId] = true;

        bytes memory payload = abi.encodeCall(
            ICrossPoolHedger.executeHedgeSwapFromReactive, (CALLBACK_SENDER, targetPoolId, swapAmount, currentImbalance)
        );

        emit HedgeCallbackQueued(targetPoolId, swapAmount, currentImbalance);
        emit Callback(DESTINATION_CHAIN_ID, HOOK_ADDRESS, CALLBACK_GAS_LIMIT, payload);
    }

    function computeHedgeParams(int256 imbalance) external view returns (bytes32 targetPoolId, int256 swapAmount) {
        return _computeHedgeParams(imbalance);
    }

    function _computeHedgeParams(int256 imbalance) internal view returns (bytes32 targetPoolId, int256 swapAmount) {
        if (imbalance > 0) {
            return (POOL_A_ID, -(imbalance / 2));
        }
        return (POOL_B_ID, int256(ExposureMath.abs(imbalance)) / 2);
    }

    function _configureSubscription(bool revertOnFailure) internal {
        if (subscriptionConfigured) return;
        if (vm) {
            emit SubscriptionUnavailable();
            return;
        }

        try service.subscribe(
            ORIGIN_CHAIN_ID, HOOK_ADDRESS, POOL_EXPOSURE_UPDATE_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        ) {
            subscriptionConfigured = true;
            emit SubscriptionConfigured(ORIGIN_CHAIN_ID, HOOK_ADDRESS, POOL_EXPOSURE_UPDATE_TOPIC);
        } catch {
            if (revertOnFailure) revert SubscriptionFailed();
            emit SubscriptionUnavailable();
        }
    }
}
