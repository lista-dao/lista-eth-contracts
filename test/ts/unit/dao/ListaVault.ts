import { expect } from "chai";
import { Signer } from "ethers";
import { getContractAddress } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { BoostCalculator, EmissionSchedule, ListaCore, ListaVault, MockEmissionReceiver, MockIncentiveVoting, MockListaToken, TokenLocker } from "../../../../typechain-types";
import { ETHER, WEEK, ZERO_ADDRESS, _1E18, increase } from "../../utils";

describe("ListaVault Contract", async () => {
  // constants
  const INITIAL_LOCK_WEEKS = 52;
  const LOCK_DECAY_WEEKS = 52;
  const WEEKLY_PCT = 10;
  const SCHEDULED_WEEKLY_PCT = [] as [number, number][];
  const GRACE_WEEKS = 13;

  // contracts;
  let listaVault: ListaVault;
  let listaCore: ListaCore;
  let tokenLocker: TokenLocker;
  let listaToken: MockListaToken;
  let incentiveVoting: MockIncentiveVoting;
  let emissionSchedule: EmissionSchedule;
  let mockEmissionReceiver: MockEmissionReceiver;
  let boostCalculator: BoostCalculator;

  // signers
  let owner: Signer;
  let guardian: Signer;
  let feeReceiver: Signer;
  let manager: Signer;
  let user1: Signer;
  let user2: Signer;

  beforeEach(async () => {
    // signers
    [owner, guardian, feeReceiver, manager, user1, user2] = await ethers.getSigners();

    // deploy ListaCore
    listaCore = await ethers.deployContract("ListaCore", [
      owner.getAddress(),
      guardian.getAddress(),
      ZERO_ADDRESS,
      feeReceiver.getAddress()
    ]) as ListaCore;
    await listaCore.deployed();

    // deploy TokenLocker
    tokenLocker = await ethers.deployContract("TokenLocker", [
      listaCore.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      manager.getAddress(),
      _1E18,
    ]) as TokenLocker;

    // deploy MockIncentiveVoting
    incentiveVoting = await ethers.deployContract("MockIncentiveVoting") as MockIncentiveVoting;
    await incentiveVoting.deployed();

    // calculate ListaVault address
    const listaVaultAddress = getContractAddress({
      from: await owner.getAddress(),
      nonce: (await ethers.provider.getTransactionCount(await owner.getAddress())) + 1,
    })

    // deploy ListaToken
    listaToken = await ethers.deployContract("MockListaToken", [
      listaVaultAddress,
      ZERO_ADDRESS,
      tokenLocker.address,
    ]) as MockListaToken;
    await listaToken.deployed();

    // deploy ListaVault
    listaVault = await ethers.deployContract("ListaVault", [
      listaCore.address,
      listaToken.address,
      tokenLocker.address,
      incentiveVoting.address,
      ZERO_ADDRESS,
      await manager.getAddress(),
    ]) as ListaVault;

    // deploy MockEmissionReceiver
    mockEmissionReceiver = await ethers.deployContract("MockEmissionReceiver") as MockEmissionReceiver;
    await mockEmissionReceiver.deployed();
    await mockEmissionReceiver.setVault(listaVault.address);

    // deploy EmissionSchedule
    emissionSchedule = await ethers.deployContract("EmissionSchedule", [
      listaCore.address,
      incentiveVoting.address,
      listaVault.address,
      INITIAL_LOCK_WEEKS,
      LOCK_DECAY_WEEKS,
      WEEKLY_PCT,
      SCHEDULED_WEEKLY_PCT,
    ]) as EmissionSchedule;
    await emissionSchedule.deployed();

    // deploy BoostCalculator
    boostCalculator = await ethers.deployContract("BoostCalculator", [
      listaCore.address,
      tokenLocker.address,
      GRACE_WEEKS,
    ]) as BoostCalculator;
    await boostCalculator.deployed();

    // init properties
    await tokenLocker.setLockToken(listaToken.address);
  });

  describe("registerNewReceiver()", async () => {
    it("Should OK", async () => {
      const tx = await listaVault.registerNewReceiver();
      await expect(tx).not.to.be.reverted;
      await expect(tx).to.emit(listaVault, "NewReceiverRegistered");
    });
  });

  describe("setInitialParameters(IEmissionSchedule, IBoostCalculator, uint256, uint64, uint128[], InitialAllowance[])", async () => {
    it("Should revert if caller is not manager", async () => {
      await expect(listaVault.connect(owner).setInitialParameters(
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ETHER.mul(1000),
        13,
        [1000],
        [{ receiver: user1.getAddress(), amount: ETHER }],
      ))
        .to.be.revertedWith("!deploymentManager");
    })

    it("Should OK", async () => {
      const tx = await listaVault.connect(manager).setInitialParameters(
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        ETHER.mul(1000),
        13,
        [1000],
        [{ receiver: user1.getAddress(), amount: ETHER }],
      );
      await expect(tx).not.to.be.reverted;
      await expect(tx)
        .to.be.emit(listaVault, "EmissionScheduleSet")
        .to.be.emit(listaVault, "BoostCalculatorSet")
        .to.be.emit(listaVault, "UnallocatedSupplyReduced");
    });
  });

  describe("registerReceiver(address, uint256)", async () => {
    it("Should revert if caller is not owner", async () => {
      await expect(listaVault.connect(user1).registerReceiver(mockEmissionReceiver.address, 10))
        .to.be.revertedWith("Only owner");
    });

    it("Should OK", async () => {
      const tx = await listaVault.registerReceiver(mockEmissionReceiver.address, 10);
      await expect(tx).not.to.be.reverted;
      await expect(tx)
        .to.emit(listaVault, "NewReceiverRegistered")
        .to.emit(mockEmissionReceiver, "RegisteredIdNotified");
    });
  });

  describe("setReceiverIsActive(uint256, bool)", async () => {
    it("Should revert if caller is not owner", async () => {
      await expect(listaVault.connect(user1).setReceiverIsActive(1, true))
        .to.be.revertedWith("Only owner");
    });

    it("Should revert if receiver.account is zero address", async () => {
      // register receiver
      await listaVault.registerNewReceiver();

      await expect(listaVault.setReceiverIsActive(0, true))
        .to.be.revertedWith("ID not set");
    });

    it("Should OK", async () => {
      // register receiver
      await listaVault.registerNewReceiver();
      await listaVault.registerReceiver(mockEmissionReceiver.address, 10);

      const tx = await listaVault.setReceiverIsActive(1, true);
      await expect(tx).not.to.be.reverted;
      await expect(tx).to.emit(listaVault, "ReceiverIsActiveStatusModified");
    });
  });

  describe("setEmissionSchedule(IEmissionSchedule)", async () => {
    it("Should revert if caller is not owner", async () => {
      await expect(listaVault.connect(user1).setEmissionSchedule(ZERO_ADDRESS))
        .to.be.revertedWith("Only owner");
    });

    it("Should OK if emissionSchedule is zero address", async () => {
      const tx = await listaVault.setEmissionSchedule(emissionSchedule.address);
      await expect(tx).not.to.be.reverted;
      await expect(tx).to.emit(listaVault, "EmissionScheduleSet");
    });

    it("Should OK if emissionSchedule is not zero address", async () => {
      await listaVault.setEmissionSchedule(emissionSchedule.address);

      const tx = await listaVault.setEmissionSchedule(emissionSchedule.address);
      await expect(tx).not.to.be.reverted;
      await expect(tx).to.emit(listaVault, "EmissionScheduleSet");
    });
  });

  describe("setBoostCalculator(IBoostCalculator)", async () => {
    it("Should revert if caller is not owner", async () => {
      await expect(listaVault.connect(user1).setBoostCalculator(ZERO_ADDRESS))
        .to.be.revertedWith("Only owner");
    });

    it("Should OK", async () => {
      const tx = await listaVault.setBoostCalculator(boostCalculator.address);
      await expect(tx).not.to.be.reverted;
      await expect(tx).to.emit(listaVault, "BoostCalculatorSet");
    });
  });

  describe("transferTokens(IERC20, address, uint256)", async () => {
    it("Should revert if caller is not owner", async () => {
      await expect(listaVault.connect(user1).transferTokens(listaToken.address, user1.getAddress(), ETHER))
        .to.be.revertedWith("Only owner");
    });

    it("Should revert if receiver is vault", async () => {
      await expect(listaVault.transferTokens(listaToken.address, listaVault.address, ETHER))
        .to.be.revertedWith("Self transfer denied");
    });

    it("Should revert if token is zero address", async () => {
      await expect(listaVault.transferTokens(ZERO_ADDRESS, user1.getAddress(), ETHER))
        .to.be.revertedWith("Address: call to non-contract");
    });

    it("Should OK", async () => {
      // init parameters
      await listaVault.connect(manager).setInitialParameters(
        emissionSchedule.address,
        boostCalculator.address,
        ETHER.mul(1000),
        13,
        [1000],
        [{ receiver: user1.getAddress(), amount: ETHER }],
      );

      const tx = await listaVault.transferTokens(listaToken.address, user1.getAddress(), ETHER);
      await expect(tx).not.to.be.reverted;
      await expect(tx).to.emit(listaVault, "UnallocatedSupplyReduced");

      expect(await listaToken.balanceOf(user1.getAddress())).to.be.equal(ETHER);
    });
  });

  describe("increaseUnallocatedSupply(uint256)", async () => {
    it("Should ok", async () => {
      // init parameters
      await listaVault.connect(manager).setInitialParameters(
        emissionSchedule.address,
        boostCalculator.address,
        ETHER.mul(10000),
        13,
        [ETHER],
        [{ receiver: user1.getAddress(), amount: ETHER }],
      );

      const amount = ETHER.mul(1000);
      // increase allowance
      await listaToken._mintInternal(owner.getAddress(), amount);
      await listaToken._approveInternal(owner.getAddress(), listaVault.address, amount);

      const tx = await listaVault.increaseUnallocatedSupply(amount);
      await expect(tx).not.to.be.reverted;
      await expect(tx).to.emit(listaVault, "UnallocatedSupplyIncreased");
    });
  });

  describe("allocateNewEmissions(uint256)", async () => {
    beforeEach(async () => {
      await listaVault.registerNewReceiver();
    });

    it("Should revert if caller is not the receiver.account", async () => {
      // init parameters
      await listaVault.connect(manager).setInitialParameters(
        emissionSchedule.address,
        boostCalculator.address,
        ETHER.mul(10000),
        13,
        [ETHER],
        [],
      );

      await expect(listaVault.allocateNewEmissions(1))
        .to.be.revertedWith("Receiver not registered");
    });

    it("Return 0 when at receiverUpdatedWeek", async () => {
      await listaVault.registerReceiver(mockEmissionReceiver.address, 1);

      expect(await mockEmissionReceiver.callStatic.allocateNewEmissions(1))
        .to.be.equal(0);
    });

    it("Return 0 if emissionSchedule is zero address", async () => {
      await listaVault.registerReceiver(mockEmissionReceiver.address, 1);
      await increase(WEEK);

      expect(await mockEmissionReceiver.callStatic.allocateNewEmissions(1))
        .to.be.equal(0);
    });

    it("Return amount if receiver is active", async () => {
      await listaVault.registerReceiver(mockEmissionReceiver.address, 1);
      await listaVault.setEmissionSchedule(emissionSchedule.address);
      await listaVault.setReceiverIsActive(1, true);
      await increase(WEEK);

      const tx = await mockEmissionReceiver.allocateNewEmissions(1);
      await expect(tx)
        .to.be.emit(listaVault, "IncreasedAllocation");
    });

    it("Return 0 if receiver is inactive", async () => {
      await listaVault.registerReceiver(mockEmissionReceiver.address, 1);
      await listaVault.setEmissionSchedule(emissionSchedule.address);
      await listaVault.setReceiverIsActive(1, false);
      await increase(WEEK);

      const tx = await mockEmissionReceiver.allocateNewEmissions(1);
      await expect(tx)
        .to.be.emit(listaVault, "UnallocatedSupplyIncreased");
    });
  });

  // TODO
  describe("transferAllocatedTokens()", async () => {
    beforeEach(async () => {
      await listaVault.registerNewReceiver();
    });

    it("Should revert if allocated is less than amount", async () => {
      // init parameters
      await listaVault.connect(manager).setInitialParameters(
        emissionSchedule.address,
        boostCalculator.address,
        ETHER.mul(10000),
        0,
        [ETHER, ETHER, ETHER, ETHER],
        [],
      );
      await listaVault.registerReceiver(mockEmissionReceiver.address, 1);
      await listaVault.setEmissionSchedule(emissionSchedule.address);
      await listaVault.setReceiverIsActive(1, true);
      await increase(WEEK * 2);
      await mockEmissionReceiver.allocateNewEmissions(1);

      await expect(listaVault.transferAllocatedTokens(user1.getAddress(), user2.getAddress(), ETHER))
        .to.be.revertedWithPanic(0x11);
    });

    it("Should OK if amount is 0", async () => {
      // const tx = await listaVault.transferAllocatedTokens();
      // await expect()
    });

    it("Should OK", async () => {
      // init parameters
      await listaVault.connect(manager).setInitialParameters(
        emissionSchedule.address,
        boostCalculator.address,
        ETHER.mul(10000),
        0,
        [ETHER, ETHER, ETHER, ETHER],
        [],
      );
      await listaVault.registerReceiver(mockEmissionReceiver.address, 1);
      await listaVault.setEmissionSchedule(emissionSchedule.address);
      await listaVault.setReceiverIsActive(1, true);
      await increase(WEEK * 2);

      // mock pct
      await incentiveVoting.mockSetReceiverVotePct(1, 2, ETHER);

      await mockEmissionReceiver.allocateNewEmissions(1);

      await mockEmissionReceiver.transferAllocatedTokens(user1.getAddress(), user2.getAddress(), ETHER);

      // check transfer
    });
  });

  // TODO
  describe("batchClaimRewards()", async () => {
    beforeEach(async () => {
      await listaVault.registerNewReceiver();
    });

    it("Should revert if maxFeePct is greater than 10000", async () => {
      await expect(listaVault.batchClaimRewards(user1.getAddress(), ZERO_ADDRESS, [mockEmissionReceiver.address], 10001))
        .to.be.revertedWith("Invalid maxFeePct");
    });

    it("Should OK", async () => {
      // init parameters
      await listaVault.connect(manager).setInitialParameters(
        emissionSchedule.address,
        boostCalculator.address,
        ETHER.mul(10000),
        0,
        [ETHER, ETHER, ETHER, ETHER],
        [],
      );
      await listaVault.registerReceiver(mockEmissionReceiver.address, 1);
      await listaVault.setEmissionSchedule(emissionSchedule.address);
      await listaVault.setReceiverIsActive(1, true);
      await increase(WEEK * 2);

      // mock pct
      await incentiveVoting.mockSetReceiverVotePct(1, 2, ETHER);

      await mockEmissionReceiver.allocateNewEmissions(1);

      await mockEmissionReceiver.batchClaimRewards(user1.getAddress(), ZERO_ADDRESS, [mockEmissionReceiver.address], 0);
    });
  });

  describe("claimBoostDelegationFees()", async () => {
    it("Should revert if amount is less than lockToTokenRatio", async () => {
      await expect(listaVault.claimBoostDelegationFees(user1.getAddress()))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should OK", async () => { });
  });

  // TODO
  describe("claimableRewardAfterBoost()", async () => { });

  // TODO
  describe("setBoostDelegationParams()", async () => { });

  // TODO
  describe("getClaimableWithBoost()", async () => { });

  // TODO
  describe("claimableBoostDelegationFees()", async () => { });
});