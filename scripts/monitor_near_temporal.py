#!/usr/bin/env python3
"""Read-only cron monitor for the LCP testnet temporal boundary fixture."""

import argparse
import base64
import datetime as dt
import json
import subprocess
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

CONTRACT_ID = "livingcommitmentsprotocol.testnet"
COMMITMENT_ID = "21"
RPC_URL = "https://test.rpc.fastnear.com"
TIME_ZONE = ZoneInfo("America/Santo_Domingo")
MARKER = "LCP_TEMPORAL_MONITOR_COMMITMENT_21"
CRONTAB = "/usr/bin/crontab"
PYTHON = "/Users/gilbertoadon/.local/bin/python3"
SCRIPT = "/Users/gilbertoadon/Downloads/Develop/Living Commitments Protocol/scripts/monitor_near_temporal.py"
LOG_PATH = Path("/private/tmp/lcp-temporal-monitor-21.jsonl")
STATE_PATH = Path("/private/tmp/lcp-temporal-monitor-21.state.json")
YOCTO_PER_SECOND = 1_000_000_000
UTC = dt.timezone.utc


def timestamp_iso(timestamp_ns, timezone=UTC):
    seconds, nanoseconds = divmod(timestamp_ns, YOCTO_PER_SECOND)
    timestamp = dt.datetime.fromtimestamp(seconds, UTC).replace(microsecond=nanoseconds // 1_000)
    return timestamp.astimezone(timezone).isoformat()


def append_log(event):
    event["observed_at_utc"] = dt.datetime.now(UTC).isoformat()
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as output:
        output.write(json.dumps(event, separators=(",", ":")) + "\n")


def read_state():
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def write_state(state):
    temporary_path = STATE_PATH.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    temporary_path.replace(STATE_PATH)


def rpc(method, params):
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": "lcp-temporal-monitor",
        "method": method,
        "params": params,
    }).encode()
    request = urllib.request.Request(RPC_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read())
    if "error" in payload:
        raise RuntimeError(
            "NEAR RPC error: {}".format(json.dumps(payload["error"], separators=(",", ":")))
        )
    return payload["result"]


def view(method, args):
    encoded_args = base64.b64encode(json.dumps(args, separators=(",", ":")).encode()).decode()
    result = rpc(
        "query",
        {
            "request_type": "call_function",
            "finality": "final",
            "account_id": CONTRACT_ID,
            "method_name": method,
            "args_base64": encoded_args,
        },
    )
    if result.get("error"):
        raise RuntimeError("NEAR view {} failed: {}".format(method, result["error"]))
    return json.loads(bytes(result["result"]))


def crontab_lines():
    result = subprocess.run([CRONTAB, "-l"], capture_output=True, text=True, check=False)
    if result.returncode == 0:
        return result.stdout.splitlines()
    message = (result.stdout + result.stderr).lower()
    if result.returncode == 1 and "no crontab" in message:
        return []
    raise RuntimeError("Could not read the user's crontab: {}".format((result.stderr or result.stdout).strip()))


def remove_cron_entries():
    existing = crontab_lines()
    remaining = [line for line in existing if MARKER not in line]
    if remaining == existing:
        return False
    content = "\n".join(remaining)
    if content:
        content += "\n"
    subprocess.run([CRONTAB, "-"], input=content, text=True, check=True)
    return True


def cron_command(mode):
    return '{} "{}" {} # {}'.format(PYTHON, SCRIPT, mode, MARKER)


def install_cron_entries():
    existing = [line for line in crontab_lines() if MARKER not in line]
    entries = [
        "* 19-23 8 11 * " + cron_command("--once"),
        "* 0-2 9 11 * " + cron_command("--once"),
        "0 3 9 11 * " + cron_command("--cleanup"),
    ]
    content = "\n".join(existing + entries)
    if content:
        content += "\n"
    subprocess.run([CRONTAB, "-"], input=content, text=True, check=True)
    return entries


def monitor_once():
    now_local = dt.datetime.now(TIME_ZONE)
    if now_local.year != 2026 or (now_local.month, now_local.day) not in ((11, 8), (11, 9)):
        append_log({"event": "monitor_window_expired", "local_time": now_local.isoformat()})
        remove_cron_entries()
        return

    state = read_state()
    try:
        block = rpc("block", {"finality": "final"})
        block_timestamp_ns = int(block["header"]["timestamp_nanosec"])
        commitment = view("get_commitment", {"commitment_id": COMMITMENT_ID})
        policy = view("get_policy", {"commitment_id": COMMITMENT_ID})
        health = view("get_effective_health", {"commitment_id": COMMITMENT_ID})
        if not commitment or not policy or not isinstance(health, str):
            raise RuntimeError("Commitment, policy, or effective health view is missing")

        activated_at_ns = int(commitment["activated_at_ns"])
        initial_deadline_ns = activated_at_ns + int(policy["temporal"]["initial_window_ns"])
        breach_at_ns = initial_deadline_ns + int(policy["temporal"]["grace_ns"])
        event = {
            "event": "health_sample",
            "commitment_id": COMMITMENT_ID,
            "lifecycle": commitment["lifecycle"],
            "health": health,
            "previous_health": state.get("health"),
            "state_changed": state.get("health") != health,
            "block_timestamp_ns": str(block_timestamp_ns),
            "block_time_utc": timestamp_iso(block_timestamp_ns),
            "initial_deadline_ns": str(initial_deadline_ns),
            "initial_deadline_local": timestamp_iso(initial_deadline_ns, TIME_ZONE),
            "breach_at_ns": str(breach_at_ns),
            "breach_at_local": timestamp_iso(breach_at_ns, TIME_ZONE),
        }
        append_log(event)
        state.update({"health": health, "last_block_timestamp_ns": str(block_timestamp_ns), "last_error": None})
        write_state(state)

        if health in ("Breached", "Closed"):
            append_log({"event": "monitor_complete", "commitment_id": COMMITMENT_ID, "health": health})
            remove_cron_entries()
    except Exception as error:
        message = str(error)
        if state.get("last_error") != message:
            append_log({"event": "monitor_error", "commitment_id": COMMITMENT_ID, "message": message})
        state["last_error"] = message
        write_state(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="sample finalized health once")
    mode.add_argument("--install", action="store_true", help="install the bounded cron schedule")
    mode.add_argument("--cleanup", action="store_true", help="remove this monitor's cron entries")
    args = parser.parse_args()

    if args.once:
        monitor_once()
    elif args.install:
        entries = install_cron_entries()
        append_log({"event": "monitor_installed", "commitment_id": COMMITMENT_ID, "cron_entries": entries})
        monitor_once()
        current_state = read_state()
        print(json.dumps({
            "commitment_id": COMMITMENT_ID,
            "cron_entries": entries,
            "initial_health": current_state.get("health"),
            "initial_error": current_state.get("last_error"),
            "log_path": str(LOG_PATH),
        }, separators=(",", ":")))
    else:
        removed = remove_cron_entries()
        append_log({
            "event": "monitor_window_ended",
            "commitment_id": COMMITMENT_ID,
            "cron_entries_removed": removed,
        })


if __name__ == "__main__":
    main()
