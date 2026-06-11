// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {CrossPoolHedgerRSC} from "../src/rsc/CrossPoolHedgerRSC.sol";

contract CrossPoolHedgerRSCTest is Test {
    CrossPoolHedgerRSC rsc;

    uint256 originChainId = 1301;
    uint256 destinationChainId = 1301;
    address hookAddress = address(0xCAFE);
    bytes32 poolAId = keccak256("POOL_A");
    bytes32 poolBId = keccak256("POOL_B");

    function setUp() public {
        rsc =
            new CrossPoolHedgerRSC(originChainId, destinationChainId, hookAddress, poolAId, poolBId, 1e16, 10, 350_000);
    }

    function test_react_ignoresWrongOrigin() public {
        IReactive.LogRecord memory log = _log(poolAId, 999, hookAddress, 2e16, 2e16, 20);
        rsc.react(log);
        assertEq(rsc.netExposureA(), 0);
    }

    function test_react_updatesExposureAndQueuesCallback() public {
        IReactive.LogRecord memory log = _log(poolAId, originChainId, hookAddress, 2e16, 2e16, 20);
        rsc.react(log);

        assertEq(rsc.netExposureA(), 2e16);
        assertEq(rsc.lastImbalance(), 2e16);
        assertTrue(rsc.callbackQueued(poolAId));

        (bytes32 targetPool, int256 swapAmount) = rsc.computeHedgeParams(2e16);
        assertEq(targetPool, poolAId);
        assertEq(swapAmount, -1e16);
    }

    function test_react_doesNotQueueDuplicateOrCooldownBlockedCallbacks() public {
        IReactive.LogRecord memory first = _log(poolAId, originChainId, hookAddress, 2e16, 2e16, 20);
        rsc.react(first);
        assertTrue(rsc.callbackQueued(poolAId));
        assertEq(rsc.lastHedgeBlock(), 20);

        IReactive.LogRecord memory duplicate = _log(poolAId, originChainId, hookAddress, 3e16, 3e16, 21);
        rsc.react(duplicate);
        assertEq(rsc.lastHedgeBlock(), 20);

        IReactive.LogRecord memory cooldownBlocked = _log(poolBId, originChainId, hookAddress, -4e16, -1e16, 25);
        rsc.react(cooldownBlocked);
        assertFalse(rsc.callbackQueued(poolBId));
        assertEq(rsc.lastHedgeBlock(), 20);
    }

    function test_react_doesNotQueueBelowThreshold() public {
        IReactive.LogRecord memory log = _log(poolAId, originChainId, hookAddress, 5e15, 5e15, 20);
        rsc.react(log);

        assertEq(rsc.netExposureA(), 5e15);
        assertFalse(rsc.callbackQueued(poolAId));
    }

    function test_react_updatesPoolBAndComputesNegativeHedge() public {
        IReactive.LogRecord memory log = _log(poolBId, originChainId, hookAddress, -3e16, -3e16, 20);
        rsc.react(log);

        assertEq(rsc.netExposureB(), -3e16);
        assertTrue(rsc.callbackQueued(poolBId));

        (bytes32 targetPool, int256 swapAmount) = rsc.computeHedgeParams(-3e16);
        assertEq(targetPool, poolBId);
        assertEq(swapAmount, 15e15);
    }

    function test_react_ignoresUnknownPoolAndCorrectsMismatchedCombinedValue() public {
        IReactive.LogRecord memory unknown = _log(keccak256("UNKNOWN"), originChainId, hookAddress, 2e16, 2e16, 20);
        rsc.react(unknown);
        assertEq(rsc.lastImbalance(), 0);

        IReactive.LogRecord memory mismatched = _log(poolAId, originChainId, hookAddress, 2e16, 0, 21);
        rsc.react(mismatched);
        assertEq(rsc.lastImbalance(), 2e16);
    }

    function test_configureSubscription_inVmEmitsUnavailableAndWrongAdminReverts() public {
        rsc.configureSubscription();

        vm.prank(address(0xBAD));
        vm.expectRevert(CrossPoolHedgerRSC.OnlySubscriptionAdmin.selector);
        rsc.configureSubscription();
    }

    function test_constructorConfiguresSubscriptionWhenSystemContractExists() public {
        address system = 0x0000000000000000000000000000000000fffFfF;
        MockSystemContract mock = new MockSystemContract(false);
        vm.etch(system, address(mock).code);

        CrossPoolHedgerRSC liveLike =
            new CrossPoolHedgerRSC(originChainId, destinationChainId, hookAddress, poolAId, poolBId, 1e16, 10, 350_000);

        assertTrue(liveLike.subscriptionConfigured());
        liveLike.configureSubscription();
        assertTrue(liveLike.subscriptionConfigured());
    }

    function test_internalConfigureSubscriptionNoopsWhenAlreadyConfigured() public {
        address system = 0x0000000000000000000000000000000000fffFfF;
        MockSystemContract mock = new MockSystemContract(false);
        vm.etch(system, address(mock).code);

        CrossPoolHedgerRSCHarness liveLike = new CrossPoolHedgerRSCHarness(
            originChainId, destinationChainId, hookAddress, poolAId, poolBId, 1e16, 10, 350_000
        );

        assertTrue(liveLike.subscriptionConfigured());
        liveLike.exposedConfigureSubscription(true);
        assertTrue(liveLike.subscriptionConfigured());
    }

    function test_configureSubscriptionRevertsWhenSystemSubscribeFails() public {
        address system = 0x0000000000000000000000000000000000fffFfF;
        MockSystemContract mock = new MockSystemContract(true);
        vm.etch(system, address(mock).code);

        CrossPoolHedgerRSC liveLike =
            new CrossPoolHedgerRSC(originChainId, destinationChainId, hookAddress, poolAId, poolBId, 1e16, 10, 350_000);

        vm.expectRevert(CrossPoolHedgerRSC.SubscriptionFailed.selector);
        liveLike.configureSubscription();
    }

    function _log(
        bytes32 poolId,
        uint256 chainId,
        address emitter,
        int256 netExposure,
        int256 combinedImbalance,
        uint256 eventBlock
    ) internal view returns (IReactive.LogRecord memory record) {
        record.chain_id = chainId;
        record._contract = emitter;
        record.topic_0 = rsc.POOL_EXPOSURE_UPDATE_TOPIC();
        record.topic_1 = uint256(poolId);
        record.data = abi.encode(netExposure, combinedImbalance, eventBlock);
        record.block_number = eventBlock;
    }
}

contract MockSystemContract {
    bool public immutable shouldRevert;

    constructor(bool shouldRevert_) {
        shouldRevert = shouldRevert_;
    }

    receive() external payable {}

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function subscribe(uint256, address, uint256, uint256, uint256, uint256) external view {
        if (shouldRevert) revert("subscribe failed");
    }

    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external view {
        if (shouldRevert) revert("unsubscribe failed");
    }
}

contract CrossPoolHedgerRSCHarness is CrossPoolHedgerRSC {
    constructor(
        uint256 originChainId,
        uint256 destinationChainId,
        address hookAddress,
        bytes32 poolAId,
        bytes32 poolBId,
        int256 hedgeThreshold,
        uint256 cooldownBlocks,
        uint64 callbackGasLimit
    )
        CrossPoolHedgerRSC(
            originChainId,
            destinationChainId,
            hookAddress,
            poolAId,
            poolBId,
            hedgeThreshold,
            cooldownBlocks,
            callbackGasLimit
        )
    {}

    function exposedConfigureSubscription(bool revertOnFailure) external {
        _configureSubscription(revertOnFailure);
    }
}
