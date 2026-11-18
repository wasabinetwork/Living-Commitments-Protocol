#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Account, JsonRpcProvider, KeyPairSigner, actions } from "near-api-js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const sandboxDeps = join(repoRoot, "tests/sandbox-usdc-callbacks/node_modules");
const sandboxRunner = join(sandboxDeps, "near-sandbox/dist/cjs/run.cjs");
const defaultWasm = join(repoRoot, "target/wasm32-unknown-unknown/release/lcp_core.wasm");

function usage() {
  return `Usage: node scripts/empty-console-fixture.mjs [options]

Starts an isolated NEAR Sandbox, deploys the current LCP core WASM to
test.near, initializes it, asserts an empty commitment list, and serves the
Console against that RPC. The sandbox and any Console process are stopped on
Ctrl-C. No testnet account or public network is used.

Options:
  --rpc-port N       Host port for the Sandbox RPC (default: 3030)
  --console-port N   Console dev-server port (default: 3000)
  --wasm PATH        Contract WASM (default: target/.../lcp_core.wasm)
  --no-console       Start and verify the contract without the Console
  --help             Show this help

Prerequisites:
  docker
  npm ci
  npm ci --prefix tests/sandbox-usdc-callbacks
  cargo build -p lcp-core --target wasm32-unknown-unknown --release --locked

Environment:
  LCP_SANDBOX_CACHE_DIR        Binary cache (default: system temp directory)
  LCP_SANDBOX_DOCKER_PLATFORM  Docker platform (default: host architecture)
  LCP_FIXTURE_PRIVATE_KEY      Override the Sandbox test.near key
`;
}

function parseArgs(argv) {
  const options = {
    rpcPort: 3030,
    consolePort: 3000,
    wasm: defaultWasm,
    console: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return next;
    };

    switch (arg) {
      case "--rpc-port":
        options.rpcPort = Number(value());
        break;
      case "--console-port":
        options.consolePort = Number(value());
        break;
      case "--wasm":
        options.wasm = resolve(process.cwd(), value());
        break;
      case "--no-console":
        options.console = false;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  for (const [name, port] of [
    ["--rpc-port", options.rpcPort],
    ["--console-port", options.consolePort],
  ]) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`${name} must be an integer between 1 and 65535`);
    }
  }
  if (options.rpcPort === options.consolePort) {
    throw new Error("--rpc-port and --console-port must differ");
  }
  if (!existsSync(options.wasm)) {
    throw new Error(
      `Contract WASM not found at ${options.wasm}. Build it with:\n` +
        "  cargo build -p lcp-core --target wasm32-unknown-unknown --release --locked",
    );
  }
  return options;
}

function checkPrerequisites() {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  if (docker.status !== 0) {
    throw new Error("Docker is not available. Start Docker and retry.");
  }
  if (!existsSync(sandboxRunner)) {
    throw new Error(
      "The near-sandbox runner is missing. Install the fixture dependency with:\n" +
        "  npm ci --prefix tests/sandbox-usdc-callbacks",
    );
  }
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "lcp-empty-console", method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.cause?.name ?? body.error.name}: ${body.error.cause?.info?.error_message ?? body.error.message}`);
  }
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  return body.result;
}

function containerRunning(name) {
  const result = spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", name], {
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function containerLogs(name) {
  try {
    return execFileSync("docker", ["logs", "--tail", "40", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

async function waitForRpc(url, containerName, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    if (!containerRunning(containerName)) {
      throw new Error(
        `The Sandbox container exited before RPC was ready.\n${containerLogs(containerName)}`,
      );
    }
    try {
      const status = await rpc(url, "status", {});
      if (status.chain_id?.startsWith("test-chain-")) return status;
      throw new Error(`unexpected chain_id ${status.chain_id}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Sandbox RPC did not become ready within ${timeoutMs}ms (${lastError}).`);
}

function readSandboxKey(containerName) {
  if (process.env.LCP_FIXTURE_PRIVATE_KEY) {
    return { accountId: "test.near", privateKey: process.env.LCP_FIXTURE_PRIVATE_KEY };
  }
  const candidates = ["/tmp/near-sandbox/test.near.json", "/tmp/near-sandbox/validator_key.json"];
  let lastError = "no key file";
  for (const path of candidates) {
    try {
      const raw = execFileSync("docker", ["exec", containerName, "cat", path], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parsed = JSON.parse(raw);
      const privateKey = parsed.private_key ?? parsed.secret_key;
      if (parsed.account_id && privateKey) {
        return { accountId: parsed.account_id, privateKey };
      }
      lastError = `${path} has no account_id/private_key`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    `Could not read the Sandbox test account key (${lastError}). ` +
      "Set LCP_FIXTURE_PRIVATE_KEY to the Sandbox test.near key and retry.",
  );
}

function assertSuccess(outcome, label) {
  if (outcome.status?.Failure) {
    throw new Error(`${label} failed: ${JSON.stringify(outcome.status.Failure)}`);
  }
}

async function viewCall(rpcUrl, contractId, method, args) {
  const result = await rpc(rpcUrl, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  if (!Array.isArray(result?.result)) {
    throw new Error(`Unexpected ${method} response: ${JSON.stringify(result)}`);
  }
  return {
    raw: Buffer.from(result.result).toString("utf8"),
    blockHeight: result.block_height,
  };
}

async function deployEmptyContract(options, rpcUrl, accountId, privateKey) {
  const wasm = readFileSync(options.wasm);
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  const account = new Account(
    accountId,
    new JsonRpcProvider({ url: rpcUrl }),
    KeyPairSigner.fromSecretKey(privateKey),
  );

  console.log(`[fixture] Deploying ${wasm.length} bytes to ${accountId} ...`);
  const deployment = await account.deployContract(wasm);
  assertSuccess(deployment, "deployContract");

  console.log("[fixture] Initializing with new() ...");
  const initialization = await account.signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.functionCall("new", Buffer.from("{}"), 30_000_000_000_000n, 0n)],
    waitUntil: "FINAL",
  });
  if (process.env.LCP_FIXTURE_DEBUG) {
    console.error(`[fixture] new() outcome: ${JSON.stringify(initialization.status)}`);
  }
  assertSuccess(initialization, "new()");

  const code = await rpc(rpcUrl, "query", {
    request_type: "view_code",
    finality: "final",
    account_id: accountId,
  });
  const deployedHash = createHash("sha256")
    .update(Buffer.from(code.code_base64, "base64"))
    .digest("hex");
  if (deployedHash !== wasmHash) {
    throw new Error(`Deployed code hash ${deployedHash} does not match ${wasmHash}`);
  }

  const list = await viewCall(rpcUrl, accountId, "list_commitments", {
    before_id: null,
    limit: 10,
  });
  if (list.raw !== "[]") {
    throw new Error(`Expected an empty commitment list, got ${list.raw}`);
  }

  return { wasmHash, blockHeight: list.blockHeight };
}

async function waitForConsole(url, child, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Console exited during startup with status ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Console did not become ready within ${timeoutMs}ms (${lastError}).`);
}

let stopping = false;
let consoleChild;

async function stopProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    sleep(5_000).then(() => false),
  ]);
  if (!exited) {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function cleanup(containerName) {
  if (stopping) return;
  stopping = true;
  await stopProcessGroup(consoleChild);
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  checkPrerequisites();

  const cacheDir = resolve(
    process.env.LCP_SANDBOX_CACHE_DIR ?? join(tmpdir(), "lcp-empty-console-sandbox-cache"),
  );
  mkdirSync(join(cacheDir, "bin"), { recursive: true });
  mkdirSync(join(cacheDir, "tmp"), { recursive: true });

  const containerName = `lcp-empty-console-${process.pid}-${Date.now().toString(36)}`;
  const platform =
    process.env.LCP_SANDBOX_DOCKER_PLATFORM ??
    (process.arch === "arm64" ? "linux/arm64" : "linux/amd64");
  const rpcUrl = `http://127.0.0.1:${options.rpcPort}`;

  const run = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--init",
      "--name",
      containerName,
      "--platform",
      platform,
      "-p",
      `127.0.0.1:${options.rpcPort}:3030`,
      "-v",
      `${sandboxDeps}:/sandbox/node_modules:ro`,
      "-v",
      `${cacheDir}:/cache`,
      "-e",
      "DIR_TO_DOWNLOAD_BINARY=/cache/bin",
      "-e",
      "TMPDIR=/cache/tmp",
      "-e",
      "NEAR_RPC_TIMEOUT_SECS=120",
      "node:26-trixie-slim",
      "sh",
      "-c",
      "node /sandbox/node_modules/near-sandbox/dist/cjs/run.cjs --home /tmp/near-sandbox init && " +
        "exec node /sandbox/node_modules/near-sandbox/dist/cjs/run.cjs --home /tmp/near-sandbox run " +
        "--rpc-addr 0.0.0.0:3030 --network-addr 0.0.0.0:24567",
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new Error(`Could not start the Sandbox container:\n${run.stderr || run.stdout}`);
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void cleanup(containerName).then(() => process.exit(0));
    });
  }

  try {
    const status = await waitForRpc(rpcUrl, containerName);
    console.log(`[fixture] Sandbox ready: chain ${status.chain_id}, protocol ${status.protocol_version}`);

    const { accountId, privateKey } = readSandboxKey(containerName);
    const proof = await deployEmptyContract(options, rpcUrl, accountId, privateKey);
    console.log(
      `[fixture] ${accountId} initialized; list_commitments returned [] at block ${proof.blockHeight}`,
    );
    console.log(`[fixture] Contract SHA-256 ${proof.wasmHash}`);

    const consoleUrl = `http://localhost:${options.consolePort}`;
    const environment = {
      ...process.env,
      NEXT_PUBLIC_LCP_CONTRACT_ID: accountId,
      NEXT_PUBLIC_NEAR_NETWORK_ID: "testnet",
      NEXT_PUBLIC_NEAR_RPC_URL: rpcUrl,
      NEXT_PUBLIC_NEAR_RPC_FALLBACK_URLS: "",
      NEXT_PUBLIC_LCP_EVENT_INDEXER_URL: "",
      NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL: "",
      NEXT_PUBLIC_LCP_REVIEWER_ACCESS_RECIPIENT: "",
      NEXT_TELEMETRY_DISABLED: "1",
    };

    if (options.console) {
      console.log(`[fixture] Starting the Console at ${consoleUrl} ...`);
      consoleChild = spawn(
        "npm",
        [
          "run",
          "dev",
          "--workspace=@lcp/console",
          "--",
          "-p",
          String(options.consolePort),
        ],
        {
          cwd: repoRoot,
          env: environment,
          stdio: "inherit",
          detached: process.platform !== "win32",
        },
      );
      consoleChild.once("exit", (code) => {
        if (!stopping && code !== 0) {
          console.error(`[fixture] Console exited with status ${code}.`);
          void cleanup(containerName).then(() => process.exit(code ?? 1));
        }
      });
      await waitForConsole(consoleUrl, consoleChild);
      console.log(`[fixture] Empty-state Console ready: ${consoleUrl}`);
      console.log("[fixture] Open Browse recent commitments; Ctrl-C stops the fixture.");
    } else {
      console.log(`[fixture] RPC ready: ${rpcUrl}`);
      console.log("[fixture] Press Ctrl-C to stop the Sandbox.");
    }

    const keepAlive = setInterval(() => {}, 60_000);
    try {
      await new Promise(() => {});
    } finally {
      clearInterval(keepAlive);
    }
  } finally {
    await cleanup(containerName);
  }
}

main().catch(async (error) => {
  console.error(`[fixture] ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.LCP_FIXTURE_DEBUG && error instanceof Error) console.error(error.stack);
  process.exit(1);
});
