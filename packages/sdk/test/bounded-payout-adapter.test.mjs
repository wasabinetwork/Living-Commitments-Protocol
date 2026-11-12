import assert from "node:assert/strict";
import test from "node:test";
import { LcpClient } from "../dist/index.js";

test("bounded adapter pool SDK methods target the adapter and attach funding deposits", async () => {
  const calls = [];
  const poolStatus = {
    lcp_contract_id: "lcp.testnet",
    pool_manager: "manager.testnet",
    resource_account: "recipient.testnet",
    available_yocto: "50000000000000000000000",
    pending_yocto: "0",
    pending_action_nonce: null,
    pending_kind: null,
  };
  const transport = {
    view: async (...args) => {
      calls.push(["view", ...args]);
      return poolStatus;
    },
    call: async (...args) => {
      calls.push(["call", ...args]);
      return undefined;
    },
  };
  const client = new LcpClient("lcp.testnet", transport);

  assert.equal(await client.getBoundedPayoutAdapterPoolStatus("adapter.testnet"), poolStatus);
  await client.fundBoundedPayoutAdapterPool("adapter.testnet", "50000000000000000000000");
  await client.withdrawBoundedPayoutAdapterPool(
    "adapter.testnet",
    "manager.testnet",
    "10000000000000000000000",
  );

  assert.deepEqual(calls, [
    ["view", "adapter.testnet", "get_pool_status", {}],
    ["call", "adapter.testnet", "fund_pool", {}, {
      attachedDepositYocto: "50000000000000000000000",
      gas: "100000000000000",
    }],
    ["call", "adapter.testnet", "withdraw_pool", {
      recipient: "manager.testnet",
      amount_yocto: "10000000000000000000000",
    }, { gas: "100000000000000" }],
  ]);
});
