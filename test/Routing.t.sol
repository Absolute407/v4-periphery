// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import 'forge-std/console.sol';

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/foundry-tests/utils/Deployers.sol";
import {GasSnapshot} from "forge-gas-snapshot/GasSnapshot.sol";
import {MockERC20} from "@uniswap/v4-core/test/foundry-tests/utils/MockERC20.sol";
import {PoolManager} from "@uniswap/v4-core/contracts/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/contracts/interfaces/IPoolManager.sol";
import {UniswapV4Routing} from "../contracts/Routing.sol";
import {PoolKey} from "@uniswap/v4-core/contracts/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/contracts/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/contracts/interfaces/IHooks.sol";

contract RoutingTest is Test, Deployers, GasSnapshot {
  using CurrencyLibrary for Currency;

    PoolManager manager;

    MockERC20 token0;
    MockERC20 token1;
    MockERC20 token2;

    PoolKey key0;
    PoolKey key1;
    PoolKey key2;

    function setup() public {
        manager = new PoolManager(500000);

        token0 = new MockERC20("Test0", "0", 18, 2 ** 128);
        token1 = new MockERC20("Test1", "1", 18, 2 ** 128);
        token2 = new MockERC20("Test2", "2", 18, 2 ** 128);

        key0 = createPoolKey(token0, token1);
        key1 = createPoolKey(token1, token2);
        key2 = createPoolKey(token0, token2);

        setupPool(key0);
        setupPool(key1);
        setupPool(key2);
    }

    function testRouter_swapExactIn_works() public {
        console.log('here');
    }

    function createPoolKey(MockERC20 tokenA, MockERC20 tokenB) internal pure returns (PoolKey memory) {
        if (address(tokenA) > address(tokenB)) (tokenA, tokenB) = (tokenB, tokenA);
        return PoolKey(Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)), 3000, 60, IHooks(address(0)));
    }

    function setupPool(PoolKey memory poolKey) internal {
        manager.initialize(poolKey, SQRT_RATIO_1_1, ZERO_BYTES);
        manager.modifyPosition(poolKey, IPoolManager.ModifyPositionParams(-887220, 887220, 200 ether), ZERO_BYTES);

    }
}
