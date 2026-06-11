// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-hooks-public/src/utils/HookMiner.sol";
import {CrossPoolHedgerHook} from "../src/hooks/CrossPoolHedgerHook.sol";

contract DeployCrossPoolHedger is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address poolManager = vm.envAddress("POOL_MANAGER");
        address callbackProxy = vm.envOr("CALLBACK_PROXY", address(0x0000000000000000000000000000000000000001));
        address reactiveSender = vm.envOr("REACTIVE_SENDER", deployer);

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_SWAP_FLAG
        );
        bytes memory args = abi.encode(IPoolManager(poolManager), callbackProxy, reactiveSender, deployer);
        (address expectedHook, bytes32 hookSalt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(CrossPoolHedgerHook).creationCode, args);

        console2.log("Phase 1: deploy CrossPoolHedger hook");
        console2.log("Expected hook", expectedHook);
        console2.logBytes32(hookSalt);

        vm.startBroadcast(deployerKey);
        CrossPoolHedgerHook hook =
            new CrossPoolHedgerHook{salt: hookSalt}(IPoolManager(poolManager), callbackProxy, reactiveSender, deployer);
        vm.stopBroadcast();

        require(address(hook) == expectedHook, "hook address mismatch");
        console2.log("CrossPoolHedgerHook", address(hook));
        console2.log("PoolManager", poolManager);
        console2.log("CallbackProxy", callbackProxy);
        console2.log("ReactiveSender", reactiveSender);
    }
}
