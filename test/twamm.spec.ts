import { BigNumber, BigNumberish, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { TWAMMTest } from '../typechain/TWAMMTest'
import checkObservationEquals from './shared/checkObservationEquals'
import { expect } from './shared/expect'
import snapshotGasCost from '@uniswap/snapshot-gas-cost'
import { encodeSqrtPriceX96, expandTo18Decimals, MaxUint128 } from './shared/utilities'
import { inOneBlock, mineNextBlock, setNextBlocktime } from './shared/evmHelpers'
import { TickMathTest } from '../typechain/TickMathTest'

function nIntervalsFrom(timestamp: number, interval: number, n: number): number {
  return timestamp + (interval - (timestamp % interval)) + interval * (n - 1)
}

function divX96(n: BigNumber): string {
  return (parseInt(n.toString()) / 2 ** 96).toString()
}

type OrderKey = {
  owner: string
  expiration: number
  zeroForOne: boolean
}

type PoolKey = {
  token0: string
  token1: string
  fee: string
  tickSpacing: number
  hooks: string
}

type PoolParams = {
  feeProtocol: number
  sqrtPriceX96: BigNumber
  fee: string
  liquidity: string
  tickSpacing: number
}

const EXPIRATION_INTERVAL = 10_000
const ZERO_ADDR = ethers.constants.AddressZero
const TICK_SPACING = 60
const FEE = '3000'

const MIN_DELTA = -1
const ZERO_FOR_ONE = true
const ONE_FOR_ZERO = false
const POOL_KEY = { token0: ZERO_ADDR, token1: ZERO_ADDR, tickSpacing: TICK_SPACING, fee: FEE, hooks: ZERO_ADDR }

describe('TWAMM', () => {
  let wallet: Wallet, other: Wallet
  let twamm: TWAMMTest
  let tickMath: TickMathTest

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>
  before('create fixture loader', async () => {
    ;[wallet, other] = await (ethers as any).getSigners()
    loadFixture = waffle.createFixtureLoader([wallet, other])
  })

  before('deploy TickMathTest', async () => {
    const factory = await ethers.getContractFactory('TickMathTest')
    tickMath = (await factory.deploy()) as TickMathTest
  })

  // Finds the time that is numIntervals away from the timestamp.
  // If numIntervals = 0, it finds the closest time.
  function findExpiryTime(timestamp: number, numIntervals: number, interval: number) {
    const nextExpirationTimestamp = timestamp + (interval - (timestamp % interval)) + numIntervals * interval
    return nextExpirationTimestamp
  }

  async function executeTwammAndThen(timestamp: number, poolParams: PoolParams, fn: () => void) {
    await inOneBlock(timestamp, async () => {
      await twamm.executeTWAMMOrders(POOL_KEY, poolParams)
      await fn()
    })
  }

  async function initTicks(ticks: number[], tickSpacing: number): Promise<void> {
    for (const tick of ticks) {
      await twamm.flipTick(tick, tickSpacing)
    }
  }

  beforeEach(async () => {
    twamm = await loadFixture(twammFixture)
  })

  const twammFixture = async () => {
    const twammTestFactory = await ethers.getContractFactory('TWAMMTest')
    return (await twammTestFactory.deploy(EXPIRATION_INTERVAL)) as TWAMMTest
  }

  describe('#isCrossingInitializedTicks', () => {
    let poolParams: PoolParams
    let poolKey: PoolKey
    beforeEach('sets the initial state of the twamm', async () => {
      poolParams = {
        feeProtocol: 0,
        sqrtPriceX96: encodeSqrtPriceX96(1, 1),
        fee: '3000',
        liquidity: '1000000000000000000000000',
        tickSpacing: 60,
      }
      poolKey = { token0: ZERO_ADDR, token1: ZERO_ADDR, tickSpacing: TICK_SPACING, fee: FEE, hooks: ZERO_ADDR }

      expect(await twamm.lastVirtualOrderTimestamp()).to.equal(0)
      await twamm.initialize()
    })

    it('returns false when swapping to the same prices', async () => {
      // set the ticks
      await initTicks([-60, 60], TICK_SPACING)
      const nextPrice = encodeSqrtPriceX96(1, 1)
      const results = await twamm.callStatic.isCrossingInitializedTick(poolParams, poolKey, nextPrice)

      expect(results.initialized).to.be.false
      expect(results.nextTickInit).to.equal(60)
    })

    it('returns true when swapping to the right', async () => {
      // set the ticks
      await initTicks([60], TICK_SPACING)
      // token1 increases
      const nextPrice = encodeSqrtPriceX96(2, 1)
      const results = await twamm.callStatic.isCrossingInitializedTick(poolParams, poolKey, nextPrice)

      expect(results.initialized).to.be.true
      expect(results.nextTickInit).to.equal(60)
    })

    it('returns true when swapping to the left', async () => {
      // set the ticks
      await initTicks([-60], TICK_SPACING)
      // token0 increases
      const nextPrice = encodeSqrtPriceX96(1, 2)
      const results = await twamm.callStatic.isCrossingInitializedTick(poolParams, poolKey, nextPrice)

      expect(results.initialized).to.be.true
      expect(results.nextTickInit).to.equal(-60)
    })

    it('returns false when swapping right and tick is after the target price', async () => {
      const targetTick = 60
      const nextInitializedTick = 120
      const priceAtTick = await tickMath.getSqrtRatioAtTick(targetTick)

      await initTicks([nextInitializedTick], TICK_SPACING)
      const results = await twamm.callStatic.isCrossingInitializedTick(poolParams, poolKey, priceAtTick)

      expect(results.initialized).to.be.false
    })

    it('returns false when swapping right, tick is after the target price, tick is not on tickSpacing', async () => {
      const targetTick = 119
      const nextInitializedTick = 120
      const priceAtTick = await tickMath.getSqrtRatioAtTick(targetTick)

      await initTicks([nextInitializedTick], TICK_SPACING)
      const results = await twamm.callStatic.isCrossingInitializedTick(poolParams, poolKey, priceAtTick)

      expect(results.initialized).to.be.false
    })

    it('returns false when swapping left and tick is after the target price', async () => {
      const targetTick = -60
      const nextInitializedTick = -120
      const priceAtTick = await tickMath.getSqrtRatioAtTick(targetTick)

      await initTicks([nextInitializedTick], TICK_SPACING)
      const results = await twamm.callStatic.isCrossingInitializedTick(poolParams, poolKey, priceAtTick)

      expect(results.initialized).to.be.false
    })

    it('returns false when swapping left, tick is after the target price, tick is not on tickSpacing', async () => {
      const targetTick = -100
      const nextInitializedTick = -120
      const priceAtTick = await tickMath.getSqrtRatioAtTick(targetTick)

      await initTicks([nextInitializedTick], TICK_SPACING)
      const results = await twamm.callStatic.isCrossingInitializedTick(poolParams, poolKey, priceAtTick)

      expect(results.initialized).to.be.false
    })
  })

  describe('#executeTWAMMOrders', () => {
    let latestTimestamp: number
    let timestampInitialize: number
    let timestampInterval1: number
    let timestampInterval2: number
    let timestampInterval3: number
    let timestampInterval4: number

    beforeEach(async () => {
      latestTimestamp = (await ethers.provider.getBlock('latest')).timestamp
      timestampInitialize = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 1)
      timestampInterval1 = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 2)
      timestampInterval2 = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 3)
      timestampInterval3 = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 4)
      timestampInterval4 = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 5)
    })

    describe('both pools selling', () => {
      beforeEach(async () => {
        await setNextBlocktime(timestampInitialize)

        const poolKey = { token0: ZERO_ADDR, token1: ZERO_ADDR, tickSpacing: TICK_SPACING, fee: FEE, hooks: ZERO_ADDR }
        await twamm.initialize()

        await inOneBlock(timestampInterval1, async () => {
          await twamm.submitOrder(
            {
              zeroForOne: true,
              owner: wallet.address,
              expiration: timestampInterval2,
            },
            expandTo18Decimals(1)
          )

          await twamm.submitOrder(
            {
              zeroForOne: false,
              owner: wallet.address,
              expiration: timestampInterval3,
            },
            expandTo18Decimals(5)
          )

          await twamm.submitOrder(
            {
              zeroForOne: false,
              owner: wallet.address,
              expiration: timestampInterval4,
            },
            expandTo18Decimals(2)
          )

          await twamm.submitOrder(
            {
              zeroForOne: true,
              owner: wallet.address,
              expiration: timestampInterval4,
            },
            expandTo18Decimals(2)
          )
        })
      })

      it('updates all necessary intervals when block is mined exactly on an interval')

    })

    describe('single pool sell', () => {
      beforeEach(async () => {
        await setNextBlocktime(timestampInterval1 - 1_000)

        const poolKey = { token0: ZERO_ADDR, token1: ZERO_ADDR, tickSpacing: TICK_SPACING, fee: FEE, hooks: ZERO_ADDR }
        await twamm.initialize()

        await inOneBlock(timestampInterval1, async () => {
          await twamm.submitOrder(
            {
              zeroForOne: true,
              owner: wallet.address,
              expiration: timestampInterval2,
            },
            expandTo18Decimals(1)
          )

          await twamm.submitOrder(
            {
              zeroForOne: true,
              owner: wallet.address,
              expiration: timestampInterval3,
            },
            expandTo18Decimals(5)
          )

          await twamm.submitOrder(
            {
              zeroForOne: true,
              owner: wallet.address,
              expiration: timestampInterval4,
            },
            expandTo18Decimals(2)
          )
        })
      })

      it('one interval gas', async () => {
        const sqrtPriceX96 = encodeSqrtPriceX96(1, 1)
        const liquidity = '10000000000000000000'
        await setNextBlocktime(timestampInterval2 + 500)
        await snapshotGasCost(twamm.executeTWAMMOrders(POOL_KEY, { sqrtPriceX96, liquidity }))
      })

      it('two intervals gas', async () => {
        const sqrtPriceX96 = encodeSqrtPriceX96(1, 1)
        const liquidity = '10000000000000000000'
        await setNextBlocktime(timestampInterval3 + 5_000)
        await snapshotGasCost(twamm.executeTWAMMOrders(POOL_KEY, { sqrtPriceX96, liquidity }))
      })

      it('three intervals gas', async () => {
        const sqrtPriceX96 = encodeSqrtPriceX96(1, 1)
        const liquidity = '10000000000000000000'
        await setNextBlocktime(timestampInterval4 + 5_000)
        await snapshotGasCost(twamm.executeTWAMMOrders(POOL_KEY, { sqrtPriceX96, liquidity }))
      })
    })
  })

  describe('end-to-end simulation', async () => {
    describe('execute both pools selling', () => {
      it('distributes correct rewards on equal trading pools at a price of 1', async () => {
        const sqrtPriceX96 = encodeSqrtPriceX96(1, 1)
        const liquidity = '1000000000000000000000000'
        const fee = '3000'
        const tickSpacing = 60
        const feeProtocol = 0

        const poolParams = { feeProtocol, sqrtPriceX96, liquidity, fee, tickSpacing }

        const poolKey = { token0: ZERO_ADDR, token1: ZERO_ADDR, tickSpacing: TICK_SPACING, fee: FEE, hooks: ZERO_ADDR }
        await twamm.initialize()

        const latestTimestamp = (await ethers.provider.getBlock('latest')).timestamp
        const timestampInterval1 = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 1)
        const timestampInterval2 = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 3)
        const timestampInterval3 = nIntervalsFrom(latestTimestamp, EXPIRATION_INTERVAL, 4)

        const halfSellAmount = expandTo18Decimals(2.5)
        const fullSellAmount = expandTo18Decimals(5)
        const fullSellRate = fullSellAmount.div(timestampInterval2 - timestampInterval1)

        const owner = wallet.address
        const expiration = timestampInterval2
        const orderKey1 = { owner, expiration, zeroForOne: true }
        const orderKey2 = { owner, expiration, zeroForOne: true }
        const orderKey3 = { owner, expiration, zeroForOne: false }

        expect((await twamm.getOrderPool(true)).sellRate).to.eq(0)
        expect((await twamm.getOrderPool(false)).sellRate).to.eq(0)

        await executeTwammAndThen(timestampInterval1, poolParams, async () => {
          await twamm.submitOrder(
            {
              zeroForOne: true,
              owner,
              expiration: timestampInterval2,
            },
            halfSellAmount
          )
          await twamm.connect(other).submitOrder(
            {
              zeroForOne: true,
              owner: other.address,
              expiration: timestampInterval2,
            },
            halfSellAmount
          )
          await twamm.submitOrder(
            {
              zeroForOne: false,
              owner,
              expiration: timestampInterval2,
            },
            fullSellAmount
          )
        })

        expect((await twamm.getOrderPool(true)).sellRate).to.eq(fullSellRate)
        expect((await twamm.getOrderPool(false)).sellRate).to.eq(fullSellRate)
        expect((await twamm.getOrderPool(true)).earningsFactor).to.eq('0')
        expect((await twamm.getOrderPool(false)).earningsFactor).to.eq('0')

        await setNextBlocktime(timestampInterval2)
        await twamm.executeTWAMMOrders(POOL_KEY, poolParams)

        expect((await twamm.callStatic.getOrderPool(true)).sellRate).to.eq('0')
        expect((await twamm.callStatic.getOrderPool(false)).sellRate).to.eq('0')
        expect((await twamm.callStatic.getOrderPool(true)).earningsFactor).to.eq('1584563250285286751870879006720000')
        expect((await twamm.callStatic.getOrderPool(false)).earningsFactor).to.eq('1584563250285286751870879006720000')

        await setNextBlocktime(timestampInterval3)
        await twamm.executeTWAMMOrders(POOL_KEY, poolParams)

        expect((await twamm.getOrderPool(true)).sellRate).to.eq('0')
        expect((await twamm.getOrderPool(false)).sellRate).to.eq('0')
        expect((await twamm.getOrderPool(true)).earningsFactor).to.eq('1584563250285286751870879006720000')
        expect((await twamm.getOrderPool(false)).earningsFactor).to.eq('1584563250285286751870879006720000')

        expect((await twamm.getOrder(orderKey1)).sellRate).to.eq(halfSellAmount.div(20_000))
        expect((await twamm.getOrder(orderKey2)).sellRate).to.eq(halfSellAmount.div(20_000))
        expect((await twamm.getOrder(orderKey3)).sellRate).to.eq(fullSellAmount.div(20_000))

        expect((await twamm.callStatic.updateOrder(orderKey1, 0)).buyTokensOwed).to.eq(halfSellAmount)
        expect((await twamm.callStatic.updateOrder(orderKey2, 0)).buyTokensOwed).to.eq(halfSellAmount)
        expect((await twamm.callStatic.updateOrder(orderKey3, 0)).buyTokensOwed).to.eq(fullSellAmount)
      })
    })

    describe('single pool sell tests', async () => {
      let blocktime: number
      let startTime: number
      let halfTime: number
      let expiryTime: number
      let orderKey: OrderKey

      const zeroForOne = true
      const sqrtPriceX96 = encodeSqrtPriceX96(1, 1)
      const liquidity = '1000000000000000000000000'
      const fee = '3000'
      const tickSpacing = 60
      const feeProtocol = 0
      const poolParams = { feeProtocol, sqrtPriceX96, liquidity, fee, tickSpacing }

      const error = 5
      const fullSellAmount = expandTo18Decimals(5)
      const halfSellAmount = fullSellAmount.div(2)
      const halfSellAmountUnderError = halfSellAmount.sub(halfSellAmount.div(error))
      const halfSellAmountOverError = halfSellAmount.add(halfSellAmount.div(error))
      const fullSellAmountUnderErroßr = fullSellAmount.sub(fullSellAmount.div(error))
      const fullSellAmountOverError = fullSellAmount.add(fullSellAmount.div(error))

      beforeEach('submit a single long term order', async () => {
        const poolKey = { token0: ZERO_ADDR, token1: ZERO_ADDR, tickSpacing: TICK_SPACING, fee: FEE, hooks: ZERO_ADDR }
        blocktime = (await ethers.provider.getBlock('latest')).timestamp

        startTime = findExpiryTime(blocktime, 1, EXPIRATION_INTERVAL)
        halfTime = findExpiryTime(blocktime, 2, EXPIRATION_INTERVAL)
        expiryTime = findExpiryTime(blocktime, 3, EXPIRATION_INTERVAL)

        await setNextBlocktime(startTime - 1_000)
        await twamm.initialize()

        orderKey = { owner: wallet.address, expiration: expiryTime, zeroForOne: true }

        await executeTwammAndThen(startTime, poolParams, async () => {
          await twamm.submitOrder(
            {
              zeroForOne,
              owner: wallet.address,
              expiration: expiryTime,
            },
            fullSellAmount
          )
        })

        const expectedSellRate = fullSellAmount.div(expiryTime - startTime)
        const actualSellRate = (await twamm.getOrder(orderKey)).sellRate
      })

      describe('when an order is midway complete', () => {
        it('claims half the earnings', async () => {
          await setNextBlocktime(halfTime)
          twamm.executeTWAMMOrders(POOL_KEY, poolParams)
          expect((await twamm.callStatic.updateOrder(orderKey, 0)).buyTokensOwed).to.eq('2499993750015624960')
        })

        it('keeps the sell rate the same', async () => {
          expect((await twamm.getOrder(orderKey)).sellRate).to.eq('250000000000000')
          await setNextBlocktime(halfTime)
          twamm.executeTWAMMOrders(POOL_KEY, poolParams)
          await twamm.updateOrder(orderKey, 0)
          expect((await twamm.getOrder(orderKey)).sellRate).to.eq('250000000000000')
        })
      })

      describe('when an order is complete', () => {
        it('claims the correct earnings', async () => {
          await setNextBlocktime(expiryTime + 1)
          twamm.executeTWAMMOrders(POOL_KEY, poolParams)
          expect((await twamm.callStatic.updateOrder(orderKey, 0)).buyTokensOwed).to.eq('4999975000124999375')
        })

        it('sets the sell rate to 0', async () => {
          await setNextBlocktime(expiryTime + 1)
          twamm.executeTWAMMOrders(POOL_KEY, poolParams)
          await twamm.updateOrder(orderKey, 0)
          expect((await twamm.getOrder(orderKey)).sellRate).to.eq(0)
        })
      })

      it('should update state exactly to the expiry', async () => {
        setNextBlocktime(expiryTime)
        await twamm.executeTWAMMOrders(POOL_KEY, poolParams)
        const blocktime = (await ethers.provider.getBlock('latest')).timestamp
        const newExpiry = findExpiryTime(blocktime, 3, EXPIRATION_INTERVAL)
        await twamm.submitOrder(
          {
            zeroForOne: false,
            owner: wallet.address,
            expiration: newExpiry,
          },
          fullSellAmount
        )
        const orderPool0 = await twamm.getOrderPool(true)
        const orderPool1 = await twamm.getOrderPool(false)
        expect(orderPool0.sellRate.toNumber()).to.eq(0)
        expect(orderPool1.sellRate.toNumber()).to.be.greaterThan(0)
      })

      it('gas zeroForOne=true', async () => {
        mineNextBlock(expiryTime)
        await snapshotGasCost(twamm.executeTWAMMOrders(POOL_KEY, poolParams))
      })

      it('gas zeroForOne=false', async () => {
        mineNextBlock(expiryTime)
        blocktime = (await ethers.provider.getBlock('latest')).timestamp
        const newExpiryTime = findExpiryTime(blocktime, 3, EXPIRATION_INTERVAL)
        await twamm.executeTWAMMOrders(POOL_KEY, poolParams)
        await twamm.submitOrder(
          {
            zeroForOne: false,
            owner: wallet.address,
            expiration: newExpiryTime,
          },
          fullSellAmount
        )
        mineNextBlock(newExpiryTime)
        await snapshotGasCost(twamm.executeTWAMMOrders(POOL_KEY, poolParams))
      })
    })
  })
})