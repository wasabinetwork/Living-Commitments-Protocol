#!/usr/bin/env bash
# Build both mock NEP-141 token artifacts in the pinned SourceScan image.
#
# The host `cargo build` path in the README produces a different digest for the
# same source because the toolchain differs, so a second operator cannot match
# it. This script is the canonical build for the A1 reproduction: same image
# digest, same cargo-near version, same wasm-opt step on every host.
#
# It writes the two artifacts to the paths the Sandbox runner resolves:
#   target/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm
#   target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm
#
# Expected digests for the 689fbf1 fixture source are recorded in
# INDEPENDENT-REPRODUCTION-689FBF1.md; this script only prints what it built.
set -euo pipefail

IMAGE="sourcescan/cargo-near:0.23.0-rust-1.100.0"
IMAGE_DIGEST="sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="${repo_root}/target/mock-ft-pinned"
wasm_dir="${repo_root}/target/wasm32-unknown-unknown/release"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build the pinned mock tokens" >&2
  exit 1
fi

observed_digest="$(docker images --digests --format '{{.Repository}}:{{.Tag}}@{{.Digest}}' \
  | awk -v image="$IMAGE" '$0 ~ "^" image "@" { print $1 }' | sed 's/.*@//' | head -n 1)"
if [ -z "${observed_digest}" ]; then
  echo "missing ${IMAGE}; run: docker pull ${IMAGE}" >&2
  exit 1
fi
if [ "${observed_digest}" != "${IMAGE_DIGEST}" ]; then
  echo "pinned image digest mismatch: expected ${IMAGE_DIGEST}, observed ${observed_digest}" >&2
  exit 1
fi

mkdir -p "${out_dir}/variant-a" "${out_dir}/variant-b" "${wasm_dir}"

build() {
  local out="$1"
  shift
  docker run --rm --platform linux/amd64 \
    -v "${repo_root}:/repo" -v "${out_dir}:/out" -w /repo \
    "${IMAGE}" sh -lc \
    "cargo near build non-reproducible-wasm --locked --no-abi \
      --manifest-path contracts/sandbox-mock-ft/Cargo.toml --out-dir /out/${out} $*"
}

build variant-a
build variant-b --features variant-b

cp "${out_dir}/variant-a/sandbox_mock_ft.wasm" "${wasm_dir}/sandbox_mock_ft.wasm"
cp "${out_dir}/variant-b/sandbox_mock_ft.wasm" "${wasm_dir}/sandbox_mock_ft_variant_b.wasm"

echo
echo "mock-token artifacts (pinned image ${IMAGE}@${IMAGE_DIGEST}):"
shasum -a 256 "${wasm_dir}/sandbox_mock_ft.wasm" "${wasm_dir}/sandbox_mock_ft_variant_b.wasm"
