import assert from "node:assert/strict";
import test from "node:test";
import { LcpClient } from "../dist/index.js";

test("service report inbox SDK methods bind the expected contract arguments and deposits", async () => {
  const calls = [];
  const transport = {
    view: async (...args) => {
      calls.push(["view", ...args]);
      if (args[1] === "get_service_report_storage_deposit") return "15000000000000000000000";
      if (args[1] === "get_service_report_refund_balance") return "0";
      return [];
    },
    call: async (...args) => {
      calls.push(["call", ...args]);
      return undefined;
    },
  };
  const client = new LcpClient("lcp.testnet", transport);
  const report = {
    payload: { source_id: "operator-eu", evaluation_id: "3" },
    signature_hex: null,
    wallet_signature: { account_id: "operator-eu.testnet" },
  };

  assert.deepEqual(await client.getServiceReportInbox("24", "3"), []);
  assert.equal(await client.getServiceReportStorageDeposit("24", report), "15000000000000000000000");
  assert.equal(await client.getServiceReportRefundBalance("operator-eu.testnet"), "0");
  await client.submitServiceReport("24", report, "15000000000000000000000", { gas: "100000000000000" });
  await client.requestServiceEvaluationFromInbox("24", {
    attachedDepositYocto: "50000000000000000000000",
    gas: "180000000000000",
  });
  await client.reclaimServiceReport("24", "3", "operator-eu");
  await client.withdrawServiceReportRefund();

  assert.deepEqual(calls, [
    ["view", "lcp.testnet", "get_service_report_inbox", { commitment_id: "24", evaluation_id: "3" }],
    ["view", "lcp.testnet", "get_service_report_storage_deposit", { commitment_id: "24", report }],
    ["view", "lcp.testnet", "get_service_report_refund_balance", { account_id: "operator-eu.testnet" }],
    ["call", "lcp.testnet", "submit_service_report", { commitment_id: "24", report }, {
      gas: "100000000000000",
      attachedDepositYocto: "15000000000000000000000",
    }],
    ["call", "lcp.testnet", "request_service_evaluation_from_inbox", { commitment_id: "24" }, {
      attachedDepositYocto: "50000000000000000000000",
      gas: "180000000000000",
    }],
    ["call", "lcp.testnet", "reclaim_service_report", {
      commitment_id: "24",
      evaluation_id: "3",
      source_id: "operator-eu",
    }],
    ["call", "lcp.testnet", "withdraw_service_report_refund", {}],
  ]);
});
