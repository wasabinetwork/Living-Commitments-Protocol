//! One-time bootstrap and persistent sidecar configuration for USDC receipt
//! recovery. This module does not create transfers or authorize settlement.
#![allow(dead_code)]

use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env,
    json_types::U64,
    require, AccountId,
};

use crate::receipt_recovery::{
    self, CommitteeRotationV2, OriginMethodV1, ParsedCommitteeRotationV2, RecoveryIntentV1,
    RecoveryNetworkContextV1, TransferKindV1, UsdcCodeHashChangeV1,
};

const CONFIG_VERSION: u8 = 1;
const EPOCH_KEYSET_VERSION: u8 = 1;
const MAX_APPROVED_CODE_HASHES: usize = 8;
const MAX_COMMITTEE_EPOCHS: u32 = 32;
const MAX_USED_KEYS: u32 = 160;
const BOOTSTRAP_AUTHORITY_KEY: &[u8] = b"lcp:receipt-recovery-bootstrap-authority:v1";
const CONFIG_KEY: &[u8] = b"lcp:receipt-recovery-config:v1";
const EPOCH_KEYSET_PREFIX: &[u8] = b"lcp:receipt-recovery-epoch:v1:";
const USED_KEY_PREFIX: &[u8] = b"lcp:receipt-recovery-used-key:v1:";
const CONFIG_STORAGE_BOND_DOMAIN: &[u8] = b"lcp:receipt-recovery-config-storage-bond:v1:";
const EPOCH_STORAGE_BOND_DOMAIN: &[u8] = b"lcp:receipt-recovery-epoch-storage-bond:v1:";
const USED_KEYS_STORAGE_BOND_DOMAIN: &[u8] = b"lcp:receipt-recovery-used-keys-bond:v1:";
const PENDING_STORAGE_BOND_DOMAIN: &[u8] = b"lcp:receipt-recovery-pending-storage-bond:v1:";
const REGISTRY_STORAGE_BOND_DOMAIN: &[u8] = b"lcp:receipt-recovery-registry-storage-bond:v1:";
const ROTATION_PROPOSAL_CREDIT_DOMAIN: &[u8] = b"lcp:rotation-proposal-credit:v1:";
const ROTATION_EPOCH_CREDIT_DOMAIN: &[u8] = b"lcp:rotation-epoch-credit:v1:";
const MAINNET_USDC_ACCOUNT: &str =
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TESTNET_USDC_ACCOUNT: &str =
    "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const PENDING_ROTATION_KEY: &[u8] = b"lcp:receipt-recovery-pending-rotation:v1";
const PENDING_CODE_HASH_KEY: &[u8] = b"lcp:receipt-recovery-pending-code-hash:v1";
const CODE_HASH_STORAGE_BOND_DOMAIN: &[u8] = b"lcp:code-hash-proposal-bond:v1:";

#[derive(near_sdk::serde::Deserialize, near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct RecoveryBootstrapArgs {
    /// Canonical base58 encoding of the network genesis block hash.
    pub genesis_hash: String,
    /// 32-byte random value as 64 lowercase hexadecimal characters.
    pub instance_id: String,
    /// Canonical base58 NEAR Ed25519 public keys, each prefixed `ed25519:`.
    /// Keys must be strictly sorted by their decoded 32-byte value.
    pub committee_keys: Vec<String>,
    /// Canonical base58 code hashes. The active hash must be in this reviewed
    /// historical allowlist. Hashes must be strictly sorted by decoded bytes.
    pub approved_usdc_code_hashes: Vec<String>,
    pub active_usdc_code_hash: String,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
struct RecoveryConfigV1 {
    version: u8,
    chain_id: String,
    genesis_hash: [u8; 32],
    core_account_id: AccountId,
    instance_id: [u8; 32],
    token_account_id: AccountId,
    active_code_hash: [u8; 32],
    approved_code_hashes: [[u8; 32]; MAX_APPROVED_CODE_HASHES],
    approved_code_hash_count: u8,
    current_epoch: u32,
    last_rotation_generation: u64,
    activated_epoch_count: u32,
    used_key_count: u32,
    /// Consumed by every accepted code-hash proposal. Cancellation and
    /// activation do not decrement it. Fresh instances start at zero; this
    /// trailing field is not a production-state migration.
    last_code_hash_generation: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
struct RecoveryEpochKeysetV1 {
    version: u8,
    epoch: u32,
    keys: [[u8; 32]; 5],
    pending_intent_count: u64,
    active: bool,
    storage_record_id: [u8; 32],
    refund_credit_id: [u8; 32],
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
struct PendingRotationStateV1 {
    version: u8,
    proposal: CommitteeRotationV2,
    proposal_digest: [u8; 32],
    proposer: AccountId,
    proposal_credit_id: [u8; 32],
    epoch_credit_id: [u8; 32],
    proposal_storage_record_id: [u8; 32],
    epoch_storage_record_id: [u8; 32],
    registry_storage_record_id: [u8; 32],
    registry_start_index: u32,
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptRecoveryRotationViewV1 {
    pub old_epoch: u32,
    pub new_epoch: u32,
    pub proposal_generation: U64,
    pub proposal_digest: String,
    pub proposal_refund_credit_id: String,
    pub epoch_refund_credit_id: String,
    pub proposer: AccountId,
    pub activate_at_ns: U64,
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptRecoveryConfigViewV1 {
    pub version: u8,
    pub chain_id: String,
    pub genesis_hash: String,
    pub core_account_id: AccountId,
    pub instance_id: String,
    pub token_account_id: AccountId,
    pub active_usdc_code_hash: String,
    pub approved_usdc_code_hashes: Vec<String>,
    pub current_epoch: u32,
    pub current_committee_keys: Vec<String>,
    pub current_epoch_pending_intents: U64,
    pub last_rotation_generation: U64,
    pub activated_epoch_count: u32,
    pub used_key_count: u32,
    pub pending_rotation: Option<ReceiptRecoveryRotationViewV1>,
    pub last_code_hash_generation: U64,
    pub pending_code_hash_change: Option<ReceiptRecoveryCodeHashViewV1>,
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptRecoveryCodeHashViewV1 {
    pub proposal_generation: U64,
    pub proposal_digest: String,
    pub new_code_hash: String,
    pub proposer: AccountId,
    pub activate_at_ns: U64,
}

/// Captures the account that initialized the fresh instance. Deployment must
/// atomically deploy and call `new`; an uninitialized contract account can be
/// initialized by whoever reaches it first, as with ordinary NEAR contracts.
pub(crate) fn initialize_bootstrap_authority(initializer: &AccountId) {
    if env::storage_read(BOOTSTRAP_AUTHORITY_KEY).is_some() {
        env::panic_str("receipt recovery bootstrap authority already initialized");
    }
    let bytes = borsh::to_vec(initializer)
        .unwrap_or_else(|_| env::panic_str("failed to serialize recovery bootstrap authority"));
    env::storage_write(BOOTSTRAP_AUTHORITY_KEY, &bytes);
}

#[cfg(test)]
pub(crate) fn clear_initializer_for_test() {
    env::storage_remove(BOOTSTRAP_AUTHORITY_KEY);
    env::storage_remove(CONFIG_KEY);
    env::storage_remove(PENDING_ROTATION_KEY);
    env::storage_remove(PENDING_CODE_HASH_KEY);
}

/// Consumes the one-time initializer authority and writes the initial config,
/// epoch-zero keyset, and permanent used-key registry. The attached NEAR funds
/// the non-withdrawable storage reserve; insufficient funding rolls back the
/// complete call.
pub(crate) fn bootstrap(args: RecoveryBootstrapArgs) {
    require!(
        env::attached_deposit().as_yoctonear() > 0,
        "attach NEAR to fund recovery configuration storage"
    );
    require!(
        env::storage_read(CONFIG_KEY).is_none(),
        "receipt recovery is already configured"
    );

    let initializer = load_bootstrap_authority();
    require!(
        env::predecessor_account_id() == initializer,
        "only the fresh-instance initializer may configure receipt recovery"
    );

    let chain_id = env::chain_id();
    let token_account_id = usdc_account_for_chain(&chain_id);
    let genesis_hash = decode_base58_32(&args.genesis_hash, "genesis_hash");
    require!(
        genesis_hash != [0; 32],
        "genesis_hash must not be all zeroes"
    );
    let instance_id = decode_lower_hex_32(&args.instance_id, "instance_id");
    require!(instance_id != [0; 32], "instance_id must not be all zeroes");

    require!(
        args.committee_keys.len() == 5,
        "recovery committee must contain exactly five keys"
    );
    let committee = args
        .committee_keys
        .iter()
        .map(|value| decode_ed25519_key(value))
        .collect::<Vec<_>>();
    require!(
        committee.windows(2).all(|pair| pair[0] < pair[1]),
        "committee keys must be unique and sorted by raw bytes"
    );
    receipt_recovery::validate_committee(&committee)
        .unwrap_or_else(|message| env::panic_str(&message));
    let epoch_keys: [[u8; 32]; 5] = committee
        .try_into()
        .unwrap_or_else(|_| env::panic_str("recovery committee must contain five keys"));

    require!(
        !args.approved_usdc_code_hashes.is_empty()
            && args.approved_usdc_code_hashes.len() <= MAX_APPROVED_CODE_HASHES,
        "approved USDC code hash list must contain between one and eight hashes"
    );
    let approved_hashes = args
        .approved_usdc_code_hashes
        .iter()
        .map(|value| decode_base58_32(value, "approved USDC code hash"))
        .collect::<Vec<_>>();
    require!(
        approved_hashes.iter().all(|hash| hash != &[0; 32]),
        "approved USDC code hashes must not be all zeroes"
    );
    require!(
        approved_hashes.windows(2).all(|pair| pair[0] < pair[1]),
        "approved USDC code hashes must be unique and sorted by raw bytes"
    );
    let active_code_hash = decode_base58_32(&args.active_usdc_code_hash, "active USDC code hash");
    require!(
        active_code_hash != [0; 32],
        "active USDC code hash must not be all zeroes"
    );
    require!(
        approved_hashes.contains(&active_code_hash),
        "active USDC code hash must be in the approved code hash list"
    );
    let mut approved_code_hashes = [[0_u8; 32]; MAX_APPROVED_CODE_HASHES];
    for (slot, hash) in approved_code_hashes.iter_mut().zip(approved_hashes.iter()) {
        *slot = *hash;
    }

    let core_account_id = env::current_account_id();
    let config = RecoveryConfigV1 {
        version: CONFIG_VERSION,
        chain_id,
        genesis_hash,
        core_account_id,
        instance_id,
        token_account_id,
        active_code_hash,
        approved_code_hashes,
        approved_code_hash_count: u8::try_from(approved_hashes.len())
            .unwrap_or_else(|_| env::panic_str("approved code hash count overflow")),
        current_epoch: 0,
        last_rotation_generation: 0,
        activated_epoch_count: 1,
        used_key_count: 5,
        last_code_hash_generation: 0,
    };
    let epoch = RecoveryEpochKeysetV1 {
        version: EPOCH_KEYSET_VERSION,
        epoch: 0,
        keys: epoch_keys,
        pending_intent_count: 0,
        active: true,
        storage_record_id: epoch_storage_bond_id(&config, 0),
        refund_credit_id: [0; 32],
    };

    crate::recovery_accounting::top_up_storage_reserve(env::attached_deposit().as_yoctonear());
    env::storage_remove(BOOTSTRAP_AUTHORITY_KEY);
    let config_storage_usage_before = env::storage_usage();
    write_config(&config);
    crate::recovery_accounting::register_measured_record(
        config_storage_bond_id(&config),
        0,
        config_storage_usage_before,
    );

    let epoch_storage_usage_before = env::storage_usage();
    write_epoch_keyset(&epoch);
    crate::recovery_accounting::register_measured_record(
        epoch.storage_record_id,
        0,
        epoch_storage_usage_before,
    );

    let registry_storage_usage_before = env::storage_usage();
    for (index, key) in epoch_keys.iter().enumerate() {
        write_used_key(index as u32, key);
    }
    crate::recovery_accounting::register_measured_record(
        used_keys_storage_bond_id(&config),
        0,
        registry_storage_usage_before,
    );
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
}

pub(crate) fn configuration_view() -> Option<ReceiptRecoveryConfigViewV1> {
    let config = read_config()?;
    validate_config_context(&config);
    let epoch = read_epoch_keyset(config.current_epoch);
    require!(epoch.active, "active committee keyset is not marked active");
    let approved_usdc_code_hashes = config.approved_code_hashes
        [..usize::from(config.approved_code_hash_count)]
        .iter()
        .map(|hash| bs58::encode(hash).into_string())
        .collect();
    let pending_rotation = pending_rotation_view(&config);
    Some(ReceiptRecoveryConfigViewV1 {
        version: config.version,
        chain_id: config.chain_id,
        genesis_hash: bs58::encode(config.genesis_hash).into_string(),
        core_account_id: config.core_account_id,
        instance_id: encode_lower_hex_32(&config.instance_id),
        token_account_id: config.token_account_id,
        active_usdc_code_hash: bs58::encode(config.active_code_hash).into_string(),
        approved_usdc_code_hashes,
        current_epoch: config.current_epoch,
        current_committee_keys: epoch
            .keys
            .iter()
            .map(|key| format!("ed25519:{}", bs58::encode(key).into_string()))
            .collect(),
        current_epoch_pending_intents: U64(epoch.pending_intent_count),
        last_rotation_generation: U64(config.last_rotation_generation),
        activated_epoch_count: config.activated_epoch_count,
        used_key_count: config.used_key_count,
        pending_rotation,
        last_code_hash_generation: U64(config.last_code_hash_generation),
        pending_code_hash_change: pending_code_hash_view(),
    })
}

pub(crate) fn configured_token_account_id() -> AccountId {
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    config.token_account_id
}

pub(crate) fn network_context() -> RecoveryNetworkContextV1 {
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    RecoveryNetworkContextV1 {
        chain_id: config.chain_id,
        genesis_hash: config.genesis_hash,
        core_account_id: config.core_account_id.to_string(),
        instance_id: config.instance_id,
    }
}

pub(crate) fn is_configured() -> bool {
    env::storage_read(CONFIG_KEY).is_some()
}

pub(crate) fn active_committee() -> (u32, [[u8; 32]; 5]) {
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    let epoch = read_epoch_keyset(config.current_epoch);
    require!(epoch.active, "active committee keyset is not marked active");
    (config.current_epoch, epoch.keys)
}

pub(crate) fn committee_for_epoch(epoch: u32) -> Option<Vec<String>> {
    let keys = committee_keys_for_epoch(epoch)?;
    Some(
        keys.iter()
            .map(|key| format!("ed25519:{}", bs58::encode(key).into_string()))
            .collect(),
    )
}

pub(crate) fn committee_keys_for_epoch(epoch: u32) -> Option<[[u8; 32]; 5]> {
    let config = read_config()?;
    validate_config_context(&config);
    if epoch >= config.activated_epoch_count {
        return None;
    }
    let bytes = env::storage_read(&epoch_keyset_key(epoch))?;
    let keyset: RecoveryEpochKeysetV1 = borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("receipt recovery epoch keyset is malformed"));
    require!(
        keyset.version == EPOCH_KEYSET_VERSION && keyset.epoch == epoch,
        "receipt recovery epoch keyset version or ID is invalid"
    );
    receipt_recovery::validate_committee(&keyset.keys)
        .unwrap_or_else(|message| env::panic_str(&message));
    Some(keyset.keys)
}

/// Pins a new token transfer to the active committee epoch and approved USDC
/// code hash. Returns `None` only while the feature-enabled instance has not
/// been bootstrapped; once configured, any mismatch fails closed.
pub(crate) fn create_pending_intent(
    transfer_id: u64,
    commitment_id: u64,
    kind: TransferKindV1,
    tranche_epoch: Option<u32>,
    token_account_id: &AccountId,
    recipient_id: &AccountId,
    amount_raw: u128,
    origin_method: OriginMethodV1,
    ft_transfer_deposit_yocto: u128,
    ft_transfer_gas_tgas: u64,
) -> Option<RecoveryIntentV1> {
    let config = read_config()?;
    validate_config_context(&config);
    require!(
        token_account_id == &config.token_account_id,
        "receipt recovery is configured for a different token account"
    );
    require!(
        transfer_id > 0 && amount_raw > 0,
        "recovery transfer fields must be nonzero"
    );
    require!(
        ft_transfer_deposit_yocto == 1 && ft_transfer_gas_tgas == 25,
        "receipt recovery transfer parameters are unsupported"
    );
    require!(
        matches!(
            (kind, tranche_epoch, origin_method),
            (
                TransferKindV1::Tranche,
                Some(_),
                OriginMethodV1::ClaimTranche
            ) | (
                TransferKindV1::EscrowRefund,
                None,
                OriginMethodV1::RefundRemaining
            )
        ),
        "recovery transfer kind, epoch, and origin method are inconsistent"
    );
    let mut keyset = read_epoch_keyset(config.current_epoch);
    require!(
        keyset.active,
        "new recovery intent requires the active committee"
    );
    keyset.pending_intent_count = keyset
        .pending_intent_count
        .checked_add(1)
        .unwrap_or_else(|| env::panic_str("committee pending-intent count overflow"));

    let intent = RecoveryIntentV1 {
        schema_version: 1,
        chain_id: config.chain_id.clone(),
        genesis_hash: config.genesis_hash,
        core_account_id: config.core_account_id.to_string(),
        instance_id: config.instance_id,
        committee_epoch: config.current_epoch,
        transfer_id,
        commitment_id,
        kind,
        tranche_epoch,
        token_account_id: token_account_id.to_string(),
        recipient_id: recipient_id.to_string(),
        amount_raw,
        origin_method,
        token_code_hash: config.active_code_hash,
        ft_transfer_deposit_yocto,
        ft_transfer_gas_tgas,
    };
    let intent_bytes = borsh::to_vec(&intent)
        .unwrap_or_else(|_| env::panic_str("failed to serialize recovery transfer intent"));
    require!(
        intent_bytes.len() <= 500,
        "recovery transfer intent exceeds its limit"
    );

    write_epoch_keyset(&keyset);
    Some(intent)
}

pub(crate) fn propose_rotation(encoded: &str) -> ReceiptRecoveryRotationViewV1 {
    require!(
        env::attached_deposit().as_yoctonear() > 0,
        "attach NEAR to fund rotation storage"
    );
    require!(
        env::storage_read(PENDING_ROTATION_KEY).is_none(),
        "a committee rotation is already pending"
    );
    crate::recovery_accounting::assert_cash_gate_ready();

    let mut config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    require!(
        config.activated_epoch_count < MAX_COMMITTEE_EPOCHS
            && config.used_key_count <= MAX_USED_KEYS - 5,
        "committee rotation capacity is exhausted"
    );
    let current = read_epoch_keyset(config.current_epoch);
    require!(
        current.active,
        "active committee keyset is not marked active"
    );
    let used_keys = load_used_keys(&config);
    let parsed = receipt_recovery::parse_and_verify_rotation_proposal(
        encoded,
        &RecoveryNetworkContextV1 {
            chain_id: config.chain_id.clone(),
            genesis_hash: config.genesis_hash,
            core_account_id: config.core_account_id.to_string(),
            instance_id: config.instance_id,
        },
        config.current_epoch,
        config.last_rotation_generation,
        env::block_timestamp(),
        &current.keys,
        &used_keys,
    )
    .unwrap_or_else(|message| env::panic_str(&message));
    let ParsedCommitteeRotationV2 {
        proposal,
        proposal_digest,
    } = parsed;
    require!(
        env::storage_read(&epoch_keyset_key(proposal.new_epoch)).is_none(),
        "next committee epoch keyset already exists"
    );

    let deposit = env::attached_deposit().as_yoctonear();
    crate::recovery_accounting::top_up_storage_reserve(deposit);
    let storage_usage_before = env::storage_usage();
    let proposer = env::predecessor_account_id();
    let proposal_credit_id = rotation_credit_id(
        ROTATION_PROPOSAL_CREDIT_DOMAIN,
        &config,
        proposal.proposal_generation,
    );
    let epoch_credit_id = rotation_credit_id(
        ROTATION_EPOCH_CREDIT_DOMAIN,
        &config,
        proposal.proposal_generation,
    );
    require!(
        crate::recovery_accounting::read_persisted_refund_credit(&proposal_credit_id).is_none()
            && crate::recovery_accounting::read_persisted_refund_credit(&epoch_credit_id).is_none(),
        "rotation refund credit ID already exists"
    );

    let proposal_row_storage_before = env::storage_usage();
    crate::recovery_accounting::preallocate_refund_credit(
        proposal_credit_id,
        proposer.clone(),
        0,
        0,
        proposal_row_storage_before,
    );
    let epoch_row_storage_before = env::storage_usage();
    crate::recovery_accounting::preallocate_refund_credit(
        epoch_credit_id,
        proposer.clone(),
        0,
        0,
        epoch_row_storage_before,
    );

    let proposal_storage_record_id = pending_storage_bond_id(&config, proposal.proposal_generation);
    let epoch_storage_record_id = epoch_storage_bond_id(&config, proposal.new_epoch);
    let registry_start_index = config.used_key_count;
    let registry_storage_record_id =
        registry_storage_bond_id(&config, proposal.proposal_generation, registry_start_index);
    let pending = PendingRotationStateV1 {
        version: CONFIG_VERSION,
        proposal: proposal.clone(),
        proposal_digest,
        proposer,
        proposal_credit_id,
        epoch_credit_id,
        proposal_storage_record_id,
        epoch_storage_record_id,
        registry_storage_record_id,
        registry_start_index,
    };
    let pending_storage_before = env::storage_usage();
    write_pending_rotation(&pending);
    crate::recovery_accounting::register_measured_record(
        proposal_storage_record_id,
        0,
        pending_storage_before,
    );

    let reserved_epoch = RecoveryEpochKeysetV1 {
        version: EPOCH_KEYSET_VERSION,
        epoch: proposal.new_epoch,
        keys: proposal.new_keys,
        pending_intent_count: 0,
        active: false,
        storage_record_id: epoch_storage_record_id,
        refund_credit_id: epoch_credit_id,
    };
    let epoch_storage_before = env::storage_usage();
    write_epoch_keyset(&reserved_epoch);
    crate::recovery_accounting::register_measured_record(
        epoch_storage_record_id,
        0,
        epoch_storage_before,
    );

    let registry_storage_before = env::storage_usage();
    for index in registry_start_index..registry_start_index + 5 {
        require!(
            env::storage_read(&used_key_storage_key(index)).is_none(),
            "committee key registry reservation already exists"
        );
        write_used_key(index, &[0; 32]);
    }
    crate::recovery_accounting::register_measured_record(
        registry_storage_record_id,
        0,
        registry_storage_before,
    );

    config.last_rotation_generation = proposal.proposal_generation;
    write_config(&config);
    let added_bytes = env::storage_usage()
        .checked_sub(storage_usage_before)
        .unwrap_or_else(|| env::panic_str("rotation storage usage decreased unexpectedly"));
    let storage_cost = crate::recovery_accounting::measured_storage_cost(added_bytes);
    require!(
        deposit >= storage_cost,
        "rotation deposit is insufficient for measured storage"
    );
    crate::recovery_accounting::credit_released_storage_to_payer(
        proposal_credit_id,
        deposit - storage_cost,
    );
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
    rotation_view(&pending)
}

pub(crate) fn cancel_rotation(encoded: &str) -> ReceiptRecoveryRotationViewV1 {
    require!(
        env::attached_deposit().as_yoctonear() == 0,
        "do not attach a deposit to cancel a committee rotation"
    );
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    let pending = read_pending_rotation()
        .unwrap_or_else(|| env::panic_str("no committee rotation is pending"));
    validate_pending_rotation(&pending, &config);
    validate_rotation_credit_owners(&pending);
    require!(
        pending.proposal.old_epoch == config.current_epoch
            && pending.proposal.proposal_generation == config.last_rotation_generation,
        "pending rotation does not match the active configuration"
    );
    let active = read_epoch_keyset(config.current_epoch);
    let _cancellation = receipt_recovery::parse_and_verify_rotation_cancellation(
        encoded,
        &RecoveryNetworkContextV1 {
            chain_id: config.chain_id.clone(),
            genesis_hash: config.genesis_hash,
            core_account_id: config.core_account_id.to_string(),
            instance_id: config.instance_id,
        },
        &pending.proposal,
        config.current_epoch,
        env::block_timestamp(),
        &active.keys,
    )
    .unwrap_or_else(|message| env::panic_str(&message));
    let result = rotation_view(&pending);

    let before_pending_remove = env::storage_usage();
    env::storage_remove(PENDING_ROTATION_KEY);
    let pending_bond = crate::recovery_accounting::remove_measured_record(
        pending.proposal_storage_record_id,
        before_pending_remove,
        crate::recovery_accounting::StorageBondReleaseV1::Treasury,
    );

    let before_epoch_remove = env::storage_usage();
    env::storage_remove(&epoch_keyset_key(pending.proposal.new_epoch));
    let epoch_bond = crate::recovery_accounting::remove_measured_record(
        pending.epoch_storage_record_id,
        before_epoch_remove,
        crate::recovery_accounting::StorageBondReleaseV1::Treasury,
    );

    let before_registry_remove = env::storage_usage();
    for index in pending.registry_start_index..pending.registry_start_index + 5 {
        env::storage_remove(&used_key_storage_key(index));
    }
    let registry_bond = crate::recovery_accounting::remove_measured_record(
        pending.registry_storage_record_id,
        before_registry_remove,
        crate::recovery_accounting::StorageBondReleaseV1::Treasury,
    );

    crate::recovery_accounting::credit_released_storage_to_payer(
        pending.proposal_credit_id,
        crate::recovery_accounting::measured_storage_cost(pending_bond.storage_bytes),
    );
    crate::recovery_accounting::credit_released_storage_to_payer(
        pending.epoch_credit_id,
        crate::recovery_accounting::measured_storage_cost(epoch_bond.storage_bytes)
            .checked_add(crate::recovery_accounting::measured_storage_cost(
                registry_bond.storage_bytes,
            ))
            .unwrap_or_else(|| env::panic_str("rotation refund amount overflow")),
    );
    crate::recovery_accounting::seal_refund_credit(pending.proposal_credit_id);
    crate::recovery_accounting::seal_refund_credit(pending.epoch_credit_id);
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
    result
}

pub(crate) fn activate_rotation() -> ReceiptRecoveryRotationViewV1 {
    require!(
        env::attached_deposit().as_yoctonear() == 0,
        "do not attach a deposit to activate a committee rotation"
    );
    let mut config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    let pending = read_pending_rotation()
        .unwrap_or_else(|| env::panic_str("no committee rotation is pending"));
    validate_pending_rotation(&pending, &config);
    validate_rotation_credit_owners(&pending);
    require!(
        env::block_timestamp() >= pending.proposal.activate_at_ns,
        "committee rotation activation time has not arrived"
    );
    let expected_new_epoch = config
        .current_epoch
        .checked_add(1)
        .unwrap_or_else(|| env::panic_str("committee epoch overflow"));
    require!(
        pending.proposal.old_epoch == config.current_epoch
            && pending.proposal.proposal_generation == config.last_rotation_generation
            && pending.proposal.new_epoch == expected_new_epoch,
        "pending rotation does not match the active configuration"
    );
    let result = rotation_view(&pending);
    let mut old_epoch = read_epoch_keyset(config.current_epoch);
    require!(old_epoch.active, "old committee keyset is not active");
    old_epoch.active = false;
    write_epoch_keyset(&old_epoch);

    let mut new_epoch = read_epoch_keyset(pending.proposal.new_epoch);
    require!(
        !new_epoch.active
            && new_epoch.keys == pending.proposal.new_keys
            && new_epoch.storage_record_id == pending.epoch_storage_record_id
            && new_epoch.refund_credit_id == pending.epoch_credit_id,
        "reserved committee keyset does not match the proposal"
    );
    new_epoch.active = true;
    write_epoch_keyset(&new_epoch);
    for (offset, key) in pending.proposal.new_keys.iter().enumerate() {
        let index = pending.registry_start_index + offset as u32;
        let reserved = env::storage_read(&used_key_storage_key(index))
            .unwrap_or_else(|| env::panic_str("reserved committee key registry entry is missing"));
        require!(
            reserved.as_slice() == [0; 32],
            "reserved committee key registry entry is malformed"
        );
        write_used_key(index, key);
    }

    config.current_epoch = pending.proposal.new_epoch;
    config.activated_epoch_count = config
        .activated_epoch_count
        .checked_add(1)
        .unwrap_or_else(|| env::panic_str("committee epoch count overflow"));
    config.used_key_count = config
        .used_key_count
        .checked_add(5)
        .unwrap_or_else(|| env::panic_str("committee used-key count overflow"));
    write_config(&config);

    let before_pending_remove = env::storage_usage();
    env::storage_remove(PENDING_ROTATION_KEY);
    let pending_bond = crate::recovery_accounting::remove_measured_record(
        pending.proposal_storage_record_id,
        before_pending_remove,
        crate::recovery_accounting::StorageBondReleaseV1::Treasury,
    );
    crate::recovery_accounting::credit_released_storage_to_payer(
        pending.proposal_credit_id,
        crate::recovery_accounting::measured_storage_cost(pending_bond.storage_bytes),
    );
    crate::recovery_accounting::seal_refund_credit(pending.proposal_credit_id);
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
    result
}

pub(crate) fn retire_epoch(epoch: u32) -> bool {
    require!(
        env::attached_deposit().as_yoctonear() == 0,
        "do not attach a deposit to retire a committee epoch"
    );
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    if epoch == config.current_epoch || env::storage_read(&epoch_keyset_key(epoch)).is_none() {
        return false;
    }
    if epoch >= config.activated_epoch_count {
        return false;
    }
    if read_pending_rotation().is_some_and(|pending| pending.proposal.new_epoch == epoch) {
        return false;
    }
    let keyset = read_epoch_keyset(epoch);
    if keyset.active || keyset.pending_intent_count != 0 {
        return false;
    }
    let before_remove = env::storage_usage();
    env::storage_remove(&epoch_keyset_key(epoch));
    let bond = crate::recovery_accounting::remove_measured_record(
        keyset.storage_record_id,
        before_remove,
        crate::recovery_accounting::StorageBondReleaseV1::Treasury,
    );
    if keyset.refund_credit_id != [0; 32] {
        crate::recovery_accounting::credit_released_storage_to_payer(
            keyset.refund_credit_id,
            crate::recovery_accounting::measured_storage_cost(bond.storage_bytes),
        );
        crate::recovery_accounting::seal_refund_credit(keyset.refund_credit_id);
    }
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
    true
}

pub(crate) fn increment_pending_intent_count(epoch: u32) {
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    require!(
        epoch == config.current_epoch,
        "new intents must use the active epoch"
    );
    let mut keyset = read_epoch_keyset(epoch);
    require!(
        keyset.active,
        "new intents require an active committee keyset"
    );
    keyset.pending_intent_count = keyset
        .pending_intent_count
        .checked_add(1)
        .unwrap_or_else(|| env::panic_str("committee pending-intent count overflow"));
    write_epoch_keyset(&keyset);
}

pub(crate) fn decrement_pending_intent_count(epoch: u32) {
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    let mut keyset = read_epoch_keyset(epoch);
    keyset.pending_intent_count = keyset
        .pending_intent_count
        .checked_sub(1)
        .unwrap_or_else(|| env::panic_str("committee pending-intent count underflow"));
    write_epoch_keyset(&keyset);
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
struct PendingCodeHashStateV1 {
    version: u8,
    proposal: UsdcCodeHashChangeV1,
    proposal_digest: [u8; 32],
    proposer: AccountId,
    storage_record_id: [u8; 32],
}

pub(crate) fn propose_code_hash_change(encoded: &str) -> ReceiptRecoveryCodeHashViewV1 {
    let deposit = env::attached_deposit().as_yoctonear();
    require!(
        deposit > 0,
        "attach NEAR to fund the code hash proposal storage reserve"
    );
    require!(
        env::storage_read(PENDING_CODE_HASH_KEY).is_none(),
        "a USDC code hash change is already pending"
    );
    crate::recovery_accounting::assert_cash_gate_ready();
    let mut config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    let current = read_epoch_keyset(config.current_epoch);
    require!(
        current.active,
        "active committee keyset is not marked active"
    );
    let parsed = receipt_recovery::parse_and_verify_code_hash_change(
        encoded,
        &network_context_from(&config),
        config.last_code_hash_generation,
        env::block_timestamp(),
        &current.keys,
    )
    .unwrap_or_else(|message| env::panic_str(&message));
    preview_code_hash(&config, parsed.proposal.new_code_hash);
    let token_account_id = config.token_account_id.clone();
    crate::recovery_accounting::top_up_storage_reserve(deposit);
    config.last_code_hash_generation = parsed.proposal.proposal_generation;
    write_config(&config);
    require!(
        config.token_account_id == token_account_id,
        "USDC code hash change must not replace the token account"
    );
    let storage_record_id =
        code_hash_storage_record_id(&config.instance_id, parsed.proposal.proposal_generation);
    let proposer = env::predecessor_account_id();
    let pending = PendingCodeHashStateV1 {
        version: CONFIG_VERSION,
        proposal: parsed.proposal,
        proposal_digest: parsed.proposal_digest,
        proposer,
        storage_record_id,
    };
    let storage_before = env::storage_usage();
    write_pending_code_hash(&pending);
    let bond = crate::recovery_accounting::register_measured_record(
        storage_record_id,
        0,
        storage_before,
    );
    require!(
        deposit >= crate::recovery_accounting::measured_storage_cost(bond.storage_bytes),
        "code hash proposal deposit is insufficient for measured storage"
    );
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
    code_hash_view(&pending)
}

pub(crate) fn cancel_code_hash_change(encoded: &str) -> ReceiptRecoveryCodeHashViewV1 {
    require!(
        env::attached_deposit().as_yoctonear() == 0,
        "do not attach a deposit to cancel a USDC code hash change"
    );
    let config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    let pending = read_pending_code_hash()
        .unwrap_or_else(|| env::panic_str("no USDC code hash change is pending"));
    require!(
        pending.proposal.proposal_generation == config.last_code_hash_generation,
        "pending code hash change does not match the active configuration"
    );
    let active = read_epoch_keyset(config.current_epoch);
    let _cancellation = receipt_recovery::parse_and_verify_code_hash_cancellation(
        encoded,
        &network_context_from(&config),
        &pending.proposal,
        env::block_timestamp(),
        &active.keys,
    )
    .unwrap_or_else(|message| env::panic_str(&message));
    let result = code_hash_view(&pending);
    release_pending_code_hash(&pending);
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
    result
}

pub(crate) fn activate_code_hash_change() -> ReceiptRecoveryCodeHashViewV1 {
    require!(
        env::attached_deposit().as_yoctonear() == 0,
        "do not attach a deposit to activate a USDC code hash change"
    );
    let mut config =
        read_config().unwrap_or_else(|| env::panic_str("receipt recovery is not configured"));
    validate_config_context(&config);
    let pending = read_pending_code_hash()
        .unwrap_or_else(|| env::panic_str("no USDC code hash change is pending"));
    require!(
        env::block_timestamp() >= pending.proposal.activate_at_ns,
        "USDC code hash activation time has not arrived"
    );
    require!(
        pending.proposal.proposal_generation == config.last_code_hash_generation,
        "pending code hash change does not match the active configuration"
    );
    let token_account_id = config.token_account_id.clone();
    let previous_hashes = config.approved_code_hashes;
    let previous_count = config.approved_code_hash_count;
    install_code_hash(&mut config, pending.proposal.new_code_hash);
    require!(
        config.token_account_id == token_account_id,
        "USDC code hash change must not replace the token account"
    );
    require!(
        config.approved_code_hash_count >= previous_count,
        "USDC code hash change removed an approved hash"
    );
    for previous in &previous_hashes[..usize::from(previous_count)] {
        require!(
            config.approved_code_hashes[..usize::from(config.approved_code_hash_count)]
                .contains(previous),
            "USDC code hash change removed an approved hash"
        );
    }
    write_config(&config);
    let result = code_hash_view(&pending);
    release_pending_code_hash(&pending);
    crate::recovery_accounting::assert_cash_gate_ready();
    crate::native_cash::assert_solvency();
    result
}

fn preview_code_hash(config: &RecoveryConfigV1, new_hash: [u8; 32]) {
    let mut preview = config.clone();
    install_code_hash(&mut preview, new_hash);
}

fn install_code_hash(config: &mut RecoveryConfigV1, new_hash: [u8; 32]) {
    require!(
        new_hash != [0; 32],
        "USDC code hash must not be all zeroes"
    );
    let count = usize::from(config.approved_code_hash_count);
    if config.approved_code_hashes[..count].contains(&new_hash) {
        require!(
            config.active_code_hash != new_hash,
            "USDC code hash proposal does not change the active hash"
        );
        config.active_code_hash = new_hash;
        return;
    }
    require!(
        count < MAX_APPROVED_CODE_HASHES,
        "approved USDC code hash list is full"
    );
    let mut hashes = config.approved_code_hashes[..count].to_vec();
    hashes.push(new_hash);
    hashes.sort_unstable();
    require!(
        hashes.windows(2).all(|pair| pair[0] < pair[1]),
        "approved USDC code hashes must be unique and sorted by raw bytes"
    );
    for (index, hash) in hashes.iter().enumerate() {
        config.approved_code_hashes[index] = *hash;
    }
    config.approved_code_hash_count = u8::try_from(hashes.len())
        .unwrap_or_else(|_| env::panic_str("approved code hash count overflow"));
    config.active_code_hash = new_hash;
}

fn network_context_from(config: &RecoveryConfigV1) -> RecoveryNetworkContextV1 {
    RecoveryNetworkContextV1 {
        chain_id: config.chain_id.clone(),
        genesis_hash: config.genesis_hash,
        core_account_id: config.core_account_id.to_string(),
        instance_id: config.instance_id,
    }
}

fn code_hash_storage_record_id(instance_id: &[u8; 32], generation: u64) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(CODE_HASH_STORAGE_BOND_DOMAIN.len() + 40);
    bytes.extend_from_slice(CODE_HASH_STORAGE_BOND_DOMAIN);
    bytes.extend_from_slice(instance_id);
    bytes.extend_from_slice(&generation.to_le_bytes());
    env::sha256_array(&bytes)
}

fn code_hash_view(pending: &PendingCodeHashStateV1) -> ReceiptRecoveryCodeHashViewV1 {
    ReceiptRecoveryCodeHashViewV1 {
        proposal_generation: U64(pending.proposal.proposal_generation),
        proposal_digest: crate::receipt_recovery::encode_lower_hex_32(&pending.proposal_digest),
        new_code_hash: bs58::encode(pending.proposal.new_code_hash).into_string(),
        proposer: pending.proposer.clone(),
        activate_at_ns: U64(pending.proposal.activate_at_ns),
    }
}

fn pending_code_hash_view() -> Option<ReceiptRecoveryCodeHashViewV1> {
    read_pending_code_hash().map(|pending| code_hash_view(&pending))
}

fn read_pending_code_hash() -> Option<PendingCodeHashStateV1> {
    let bytes = env::storage_read(PENDING_CODE_HASH_KEY)?;
    Some(
        borsh::from_slice(&bytes)
            .unwrap_or_else(|_| env::panic_str("pending USDC code hash change is malformed")),
    )
}

fn write_pending_code_hash(pending: &PendingCodeHashStateV1) {
    let bytes = borsh::to_vec(pending)
        .unwrap_or_else(|_| env::panic_str("failed to serialize pending USDC code hash change"));
    env::storage_write(PENDING_CODE_HASH_KEY, &bytes);
}

fn release_pending_code_hash(pending: &PendingCodeHashStateV1) {
    let before_remove = env::storage_usage();
    env::storage_remove(PENDING_CODE_HASH_KEY);
    crate::recovery_accounting::remove_measured_record(
        pending.storage_record_id,
        before_remove,
        crate::recovery_accounting::StorageBondReleaseV1::Treasury,
    );
}

fn usdc_account_for_chain(chain_id: &str) -> AccountId {
    let account = match chain_id {
        "mainnet" => MAINNET_USDC_ACCOUNT,
        "testnet" => TESTNET_USDC_ACCOUNT,
        // near-sdk's unit-test chain id is the hardcoded string "test" and cannot
        // be changed from VMContextBuilder. This arm is absent from contract builds.
        #[cfg(test)]
        "test" => TESTNET_USDC_ACCOUNT,
        #[cfg(feature = "sandbox-callback-fixture")]
        chain_id if chain_id.starts_with("test-chain-") => "mock-usdc.sandbox",
        _ => env::panic_str("receipt recovery is supported only on NEAR mainnet or testnet"),
    };
    account
        .parse()
        .unwrap_or_else(|_| env::panic_str("configured USDC account ID is invalid"))
}

fn decode_ed25519_key(encoded: &str) -> [u8; 32] {
    let value = encoded
        .strip_prefix("ed25519:")
        .unwrap_or_else(|| env::panic_str("committee key must use the ed25519: prefix"));
    decode_base58_32(value, "committee key")
}

pub(crate) fn parse_credit_id(encoded: &str) -> [u8; 32] {
    let credit_id = decode_lower_hex_32(encoded, "credit_id");
    require!(credit_id != [0; 32], "credit_id must not be all zeroes");
    credit_id
}

fn decode_base58_32(encoded: &str, field: &str) -> [u8; 32] {
    require!(
        !encoded.is_empty() && encoded.len() <= 48,
        format!("{field} has an invalid encoded length")
    );
    let decoded = bs58::decode(encoded)
        .into_vec()
        .unwrap_or_else(|_| env::panic_str(&format!("{field} is not valid base58")));
    require!(
        decoded.len() == 32,
        format!("{field} must decode to 32 bytes")
    );
    require!(
        bs58::encode(&decoded).into_string() == encoded,
        format!("{field} is not canonical base58")
    );
    decoded
        .try_into()
        .unwrap_or_else(|_| env::panic_str(&format!("{field} must decode to 32 bytes")))
}

fn decode_lower_hex_32(encoded: &str, field: &str) -> [u8; 32] {
    require!(
        encoded.len() == 64,
        format!("{field} must contain 64 lowercase hex characters")
    );
    let mut decoded = [0_u8; 32];
    for (index, byte) in decoded.iter_mut().enumerate() {
        let offset = index * 2;
        let high = decode_lower_hex_nibble(encoded.as_bytes()[offset])
            .unwrap_or_else(|| env::panic_str(&format!("{field} is not lowercase hexadecimal")));
        let low = decode_lower_hex_nibble(encoded.as_bytes()[offset + 1])
            .unwrap_or_else(|| env::panic_str(&format!("{field} is not lowercase hexadecimal")));
        *byte = (high << 4) | low;
    }
    decoded
}

fn decode_lower_hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

fn encode_lower_hex_32(value: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for byte in value {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn load_bootstrap_authority() -> AccountId {
    let bytes = env::storage_read(BOOTSTRAP_AUTHORITY_KEY)
        .unwrap_or_else(|| env::panic_str("recovery bootstrap authority is unavailable"));
    borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("recovery bootstrap authority is malformed"))
}

fn read_config() -> Option<RecoveryConfigV1> {
    let bytes = env::storage_read(CONFIG_KEY)?;
    let config: RecoveryConfigV1 = borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("receipt recovery configuration is malformed"));
    validate_config(&config);
    Some(config)
}

fn validate_config(config: &RecoveryConfigV1) {
    require!(
        config.version == CONFIG_VERSION,
        "receipt recovery config version is unsupported"
    );
    require!(
        usize::from(config.approved_code_hash_count) > 0
            && usize::from(config.approved_code_hash_count) <= MAX_APPROVED_CODE_HASHES,
        "receipt recovery approved code hash count is invalid"
    );
    require!(
        config.approved_code_hashes[..usize::from(config.approved_code_hash_count)]
            .windows(2)
            .all(|pair| pair[0] < pair[1]),
        "receipt recovery approved code hashes are not canonical"
    );
    require!(
        config.approved_code_hashes[..usize::from(config.approved_code_hash_count)]
            .contains(&config.active_code_hash),
        "active USDC code hash is not approved"
    );
    require!(
        config.activated_epoch_count > 0
            && config.activated_epoch_count <= MAX_COMMITTEE_EPOCHS
            && config.current_epoch < config.activated_epoch_count
            && config.current_epoch.checked_add(1) == Some(config.activated_epoch_count)
            && config.last_rotation_generation >= u64::from(config.current_epoch),
        "receipt recovery epoch counters are inconsistent"
    );
    require!(
        config.used_key_count == config.activated_epoch_count.saturating_mul(5)
            && config.used_key_count <= MAX_USED_KEYS,
        "receipt recovery used-key registry count is inconsistent"
    );
}

fn validate_config_context(config: &RecoveryConfigV1) {
    validate_config(config);
    require!(
        config.chain_id == env::chain_id(),
        "receipt recovery chain ID mismatch"
    );
    require!(
        config.core_account_id == env::current_account_id(),
        "receipt recovery contract account mismatch"
    );
    require!(
        config.token_account_id == usdc_account_for_chain(&config.chain_id),
        "receipt recovery token account does not match the network"
    );
}

fn read_epoch_keyset(epoch: u32) -> RecoveryEpochKeysetV1 {
    let bytes = env::storage_read(&epoch_keyset_key(epoch))
        .unwrap_or_else(|| env::panic_str("receipt recovery epoch keyset is missing"));
    let keyset: RecoveryEpochKeysetV1 = borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("receipt recovery epoch keyset is malformed"));
    require!(
        keyset.version == EPOCH_KEYSET_VERSION && keyset.epoch == epoch,
        "receipt recovery epoch keyset version or ID is invalid"
    );
    keyset
}

fn write_config(config: &RecoveryConfigV1) {
    let bytes = borsh::to_vec(config)
        .unwrap_or_else(|_| env::panic_str("failed to serialize receipt recovery configuration"));
    env::storage_write(CONFIG_KEY, &bytes);
}

fn write_epoch_keyset(keyset: &RecoveryEpochKeysetV1) {
    let bytes = borsh::to_vec(keyset)
        .unwrap_or_else(|_| env::panic_str("failed to serialize receipt recovery epoch keyset"));
    env::storage_write(&epoch_keyset_key(keyset.epoch), &bytes);
}

fn write_used_key(index: u32, key: &[u8; 32]) {
    env::storage_write(&used_key_storage_key(index), key);
}

fn load_used_keys(config: &RecoveryConfigV1) -> Vec<[u8; 32]> {
    require!(
        config.used_key_count <= MAX_USED_KEYS,
        "committee used-key registry exceeds its protocol cap"
    );
    let mut keys = Vec::with_capacity(config.used_key_count as usize);
    for index in 0..config.used_key_count {
        let bytes = env::storage_read(&used_key_storage_key(index))
            .unwrap_or_else(|| env::panic_str("committee used-key registry entry is missing"));
        let key: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("committee used-key registry entry is malformed"));
        require!(key != [0; 32], "committee used-key registry entry is empty");
        require!(
            !keys.contains(&key),
            "committee used-key registry contains a duplicate"
        );
        keys.push(key);
    }
    keys
}

fn read_pending_rotation() -> Option<PendingRotationStateV1> {
    let bytes = env::storage_read(PENDING_ROTATION_KEY)?;
    let pending: PendingRotationStateV1 = borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("pending committee rotation is malformed"));
    require!(
        pending.version == CONFIG_VERSION
            && pending.proposal_digest != [0; 32]
            && pending.proposal_credit_id != [0; 32]
            && pending.epoch_credit_id != [0; 32]
            && pending.proposal_credit_id != pending.epoch_credit_id
            && pending.proposal_storage_record_id != [0; 32]
            && pending.epoch_storage_record_id != [0; 32]
            && pending.registry_storage_record_id != [0; 32],
        "pending committee rotation state is inconsistent"
    );
    Some(pending)
}

fn write_pending_rotation(pending: &PendingRotationStateV1) {
    let bytes = borsh::to_vec(pending)
        .unwrap_or_else(|_| env::panic_str("failed to serialize pending committee rotation"));
    env::storage_write(PENDING_ROTATION_KEY, &bytes);
}

fn pending_rotation_view(config: &RecoveryConfigV1) -> Option<ReceiptRecoveryRotationViewV1> {
    let pending = read_pending_rotation()?;
    validate_pending_rotation(&pending, config);
    Some(rotation_view(&pending))
}

fn rotation_view(pending: &PendingRotationStateV1) -> ReceiptRecoveryRotationViewV1 {
    ReceiptRecoveryRotationViewV1 {
        old_epoch: pending.proposal.old_epoch,
        new_epoch: pending.proposal.new_epoch,
        proposal_generation: U64(pending.proposal.proposal_generation),
        proposal_digest: encode_lower_hex_32(&pending.proposal_digest),
        proposal_refund_credit_id: encode_lower_hex_32(&pending.proposal_credit_id),
        epoch_refund_credit_id: encode_lower_hex_32(&pending.epoch_credit_id),
        proposer: pending.proposer.clone(),
        activate_at_ns: U64(pending.proposal.activate_at_ns),
    }
}

fn validate_pending_rotation(pending: &PendingRotationStateV1, config: &RecoveryConfigV1) {
    require!(
        pending.proposal.schema_version == 2
            && pending.proposal.chain_id == config.chain_id
            && pending.proposal.genesis_hash == config.genesis_hash
            && pending.proposal.core_account_id == config.core_account_id.as_str()
            && pending.proposal.instance_id == config.instance_id
            && pending.proposal.old_epoch == config.current_epoch
            && config.current_epoch.checked_add(1) == Some(pending.proposal.new_epoch)
            && pending.proposal.proposal_generation == config.last_rotation_generation
            && pending.registry_start_index == config.used_key_count
            && pending.proposal_credit_id
                == rotation_credit_id(
                    ROTATION_PROPOSAL_CREDIT_DOMAIN,
                    config,
                    pending.proposal.proposal_generation,
                )
            && pending.epoch_credit_id
                == rotation_credit_id(
                    ROTATION_EPOCH_CREDIT_DOMAIN,
                    config,
                    pending.proposal.proposal_generation,
                )
            && pending.proposal_storage_record_id
                == pending_storage_bond_id(config, pending.proposal.proposal_generation)
            && pending.epoch_storage_record_id
                == epoch_storage_bond_id(config, pending.proposal.new_epoch)
            && pending.registry_storage_record_id
                == registry_storage_bond_id(
                    config,
                    pending.proposal.proposal_generation,
                    pending.registry_start_index,
                )
            && receipt_recovery::committee_rotation_digest(&pending.proposal)
                == pending.proposal_digest,
        "pending committee rotation does not match the active configuration"
    );
}

fn validate_rotation_credit_owners(pending: &PendingRotationStateV1) {
    for credit_id in [pending.proposal_credit_id, pending.epoch_credit_id] {
        let credit = crate::recovery_accounting::read_persisted_refund_credit(&credit_id)
            .unwrap_or_else(|| env::panic_str("committee rotation refund credit is missing"));
        require!(
            credit.payer == pending.proposer,
            "committee rotation refund credit has the wrong payer"
        );
    }
}

fn config_storage_bond_id(config: &RecoveryConfigV1) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(
        CONFIG_STORAGE_BOND_DOMAIN.len() + config.core_account_id.as_bytes().len() + 32,
    );
    bytes.extend_from_slice(CONFIG_STORAGE_BOND_DOMAIN);
    bytes.extend_from_slice(config.core_account_id.as_bytes());
    bytes.extend_from_slice(&config.instance_id);
    env::sha256_array(&bytes)
}

fn epoch_storage_bond_id(config: &RecoveryConfigV1, epoch: u32) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(EPOCH_STORAGE_BOND_DOMAIN.len() + 36);
    bytes.extend_from_slice(EPOCH_STORAGE_BOND_DOMAIN);
    bytes.extend_from_slice(&config.instance_id);
    bytes.extend_from_slice(&epoch.to_le_bytes());
    env::sha256_array(&bytes)
}

fn used_keys_storage_bond_id(config: &RecoveryConfigV1) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(USED_KEYS_STORAGE_BOND_DOMAIN.len() + 32);
    bytes.extend_from_slice(USED_KEYS_STORAGE_BOND_DOMAIN);
    bytes.extend_from_slice(&config.instance_id);
    env::sha256_array(&bytes)
}

fn pending_storage_bond_id(config: &RecoveryConfigV1, generation: u64) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(PENDING_STORAGE_BOND_DOMAIN.len() + 40);
    bytes.extend_from_slice(PENDING_STORAGE_BOND_DOMAIN);
    bytes.extend_from_slice(&config.instance_id);
    bytes.extend_from_slice(&generation.to_le_bytes());
    env::sha256_array(&bytes)
}

fn registry_storage_bond_id(
    config: &RecoveryConfigV1,
    generation: u64,
    registry_start_index: u32,
) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(REGISTRY_STORAGE_BOND_DOMAIN.len() + 44);
    bytes.extend_from_slice(REGISTRY_STORAGE_BOND_DOMAIN);
    bytes.extend_from_slice(&config.instance_id);
    bytes.extend_from_slice(&generation.to_le_bytes());
    bytes.extend_from_slice(&registry_start_index.to_le_bytes());
    env::sha256_array(&bytes)
}

fn rotation_credit_id(domain: &[u8], config: &RecoveryConfigV1, generation: u64) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(domain.len() + 40);
    bytes.extend_from_slice(domain);
    bytes.extend_from_slice(&config.instance_id);
    bytes.extend_from_slice(&generation.to_le_bytes());
    env::sha256_array(&bytes)
}

fn epoch_keyset_key(epoch: u32) -> Vec<u8> {
    let mut key = Vec::with_capacity(EPOCH_KEYSET_PREFIX.len() + 4);
    key.extend_from_slice(EPOCH_KEYSET_PREFIX);
    key.extend_from_slice(&epoch.to_le_bytes());
    key
}

fn used_key_storage_key(index: u32) -> Vec<u8> {
    let mut key = Vec::with_capacity(USED_KEY_PREFIX.len() + 4);
    key.extend_from_slice(USED_KEY_PREFIX);
    key.extend_from_slice(&index.to_le_bytes());
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{accounts, VMContextBuilder},
        testing_env,
    };

    #[test]
    #[should_panic(expected = "receipt recovery bootstrap authority already initialized")]
    fn bootstrap_authority_rejects_reinitialization() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .build());
        initialize_bootstrap_authority(&accounts(0));
        initialize_bootstrap_authority(&accounts(1));
    }
}
