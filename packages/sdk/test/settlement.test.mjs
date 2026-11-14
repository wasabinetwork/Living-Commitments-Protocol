import assert from "node:assert/strict";
import test from "node:test";
import { LcpClient } from "../dist/index.js";

test("NEP-141 SDK calls bind USDC funding and NEP-145 registration arguments", async () => {
  const calls = [];
  const storageBalance = { total: "125", available: "25" };
  const storageBounds = { min: "100", max: null };
  const metadata = { spec: "ft-1.0.0", name: "USD Coin", symbol: "USDC", decimals: 6 };
  const transport = {
    view: async (...args) => {
      calls.push(["view", ...args]);
      if (args[1] === "ft_metadata") return metadata;
      if (args[1] === "storage_balance_of") return storageBalance;
      if (args[1] === "storage_balance_bounds") return storageBounds;
      return null;
    },
    call: async (...args) => {
      calls.push(["call", ...args]);
      return undefined;
    },
  };
  const client = new LcpClient("lcp.testnet", transport);
  const token = "usdc.testnet";

  assert.equal(await client.getFungibleTokenMetadata(token), metadata);
  assert.equal(await client.getFungibleTokenStorageBalance(token, "lcp.testnet"), storageBalance);
  assert.equal(await client.getFungibleTokenStorageBounds(token), storageBounds);
  await client.fundCommitmentWithToken("25", token, "4500000", { gas: "100000000000000" });
  await client.registerFungibleTokenAccount(token, "new-account.testnet", "100");
  await client.registerFungibleTokenAccount(
    token,
    "existing-account.testnet",
    "25",
    { gas: "100000000000000" },
    false,
  );

  assert.deepEqual(calls, [
    ["view", token, "ft_metadata", {}],
    ["view", token, "storage_balance_of", { account_id: "lcp.testnet" }],
    ["view", token, "storage_balance_bounds", {}],
    ["call", token, "ft_transfer_call", {
      receiver_id: "lcp.testnet",
      amount: "4500000",
      msg: JSON.stringify({ schema: "lcp.funding.v1", commitment_id: "25" }),
    }, {
      gas: "100000000000000",
      attachedDepositYocto: "1",
    }],
    ["call", token, "storage_deposit", {
      account_id: "new-account.testnet",
      registration_only: true,
    }, { attachedDepositYocto: "100" }],
    ["call", token, "storage_deposit", {
      account_id: "existing-account.testnet",
      registration_only: false,
    }, {
      gas: "100000000000000",
      attachedDepositYocto: "25",
    }],
  ]);
});
