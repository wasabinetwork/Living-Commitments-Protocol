//! Pooled USDC spendable accounting and certificate-failure quarantine.
//!
//! `SettlementState` stays unchanged. This sidecar is the only place that
//! records how much of the shared token balance may back refunds and new
//! transfers. A certificate `Failure` is a 4-of-5 attestation, not a NEAR
//! receipt proof, so its amount is quarantined instead of becoming free.
//! Callback failure does not come through this module.
#![allow(dead_code)]

use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env,
};

const POOL_KEY: &[u8] = b"lcp:usdc-pool-accounting:v1";
const QUARANTINE_PREFIX: &[u8] = b"lcp:usdc-cert-quarantine:v1:";
const QUARANTINE_TOTAL_KEY: &[u8] = b"lcp:usdc-cert-quarantine-total:v1";

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug)]
#[borsh(crate = "near_sdk::borsh")]
struct UsdcPoolAccountingV1 {
    spendable_raw: u128,
    generation: u64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct UsdcPoolSnapshot {
    pub(crate) spendable_raw: u128,
    pub(crate) generation: u64,
    pub(crate) quarantine_raw: u128,
    pub(crate) total_quarantine_raw: u128,
}

pub(crate) fn quarantine_of(commitment_id: u64) -> u128 {
    read_quarantine(commitment_id)
}

pub(crate) fn snapshot(commitment_id: u64) -> UsdcPoolSnapshot {
    let pool = read_pool();
    UsdcPoolSnapshot {
        spendable_raw: pool.spendable_raw,
        generation: pool.generation,
        quarantine_raw: read_quarantine(commitment_id),
        total_quarantine_raw: read_total(),
    }
}

/// Applies the change in gross token units (`funded - paid - refunded`).
/// Pending-only writes pass equal gross values and still advance the
/// generation so an in-flight balance view cannot release afterward.
pub(crate) fn note_gross_change(old_gross: u128, new_gross: u128) {
    let mut pool = read_pool();
    if new_gross >= old_gross {
        pool.spendable_raw = pool
            .spendable_raw
            .checked_add(new_gross - old_gross)
            .unwrap_or_else(|| env::panic_str("USDC spendable accounting overflow"));
    } else {
        pool.spendable_raw = pool
            .spendable_raw
            .checked_sub(old_gross - new_gross)
            .unwrap_or_else(|| env::panic_str("USDC spendable accounting underflow"));
    }
    bump_generation(&mut pool);
    write_pool(&pool);
}

/// Moves a certificate-failure amount out of the spendable pool. Gross is
/// unchanged: the tokens may already have left, so the amount must not become
/// free for `refund_remaining` or a new transfer.
pub(crate) fn quarantine_certificate_failure(commitment_id: u64, amount_raw: u128) {
    if amount_raw == 0 {
        env::panic_str("certificate quarantine amount must be positive");
    }
    let next = read_quarantine(commitment_id)
        .checked_add(amount_raw)
        .unwrap_or_else(|| env::panic_str("certificate quarantine overflow"));
    write_quarantine(commitment_id, next);
    write_total(
        read_total()
            .checked_add(amount_raw)
            .unwrap_or_else(|| env::panic_str("certificate quarantine total overflow")),
    );
    let mut pool = read_pool();
    pool.spendable_raw = pool.spendable_raw.checked_sub(amount_raw).unwrap_or_else(|| {
        env::panic_str("certificate quarantine exceeds USDC spendable accounting")
    });
    bump_generation(&mut pool);
    write_pool(&pool);
}

/// Releases one commitment's quarantine when `ft_balance` covers every gross
/// unit (`spendable + all quarantines`) and nothing has touched accounting
/// since the balance view was scheduled.
///
/// A shared balance cannot attribute surplus tokens to a particular
/// quarantine. Releasing whenever `ft_balance >= spendable + this_quarantine`
/// lets a caller free a false certificate while another true quarantine is
/// still supplying the surplus. Full backing refuses that release. One false
/// certificate therefore keeps every certificate quarantine locked; callback
/// failures and non-quarantined free balances are unaffected.
pub(crate) fn release_if_fully_backed(
    commitment_id: u64,
    generation: u64,
    quarantine_raw: u128,
    spendable_raw: u128,
    total_quarantine_raw: u128,
    ft_balance_raw: u128,
) -> bool {
    let pool = read_pool();
    let current_quarantine = read_quarantine(commitment_id);
    let total_quarantine = read_total();
    if pool.generation != generation
        || pool.spendable_raw != spendable_raw
        || current_quarantine != quarantine_raw
        || total_quarantine != total_quarantine_raw
        || current_quarantine == 0
    {
        env::log_str("ignored stale USDC certificate-quarantine release");
        return false;
    }
    let required = spendable_raw
        .checked_add(total_quarantine)
        .unwrap_or_else(|| env::panic_str("USDC gross accounting overflow"));
    if ft_balance_raw < required {
        env::log_str(
            "USDC balance does not cover every gross unit; certificate quarantine stays locked",
        );
        return false;
    }

    env::storage_remove(&quarantine_key(commitment_id));
    write_total(
        total_quarantine
            .checked_sub(current_quarantine)
            .unwrap_or_else(|| env::panic_str("certificate quarantine total underflow")),
    );
    let mut pool = pool;
    pool.spendable_raw = pool
        .spendable_raw
        .checked_add(current_quarantine)
        .unwrap_or_else(|| env::panic_str("USDC spendable accounting overflow"));
    bump_generation(&mut pool);
    write_pool(&pool);
    true
}

fn bump_generation(pool: &mut UsdcPoolAccountingV1) {
    pool.generation = pool
        .generation
        .checked_add(1)
        .unwrap_or_else(|| env::panic_str("USDC accounting generation overflow"));
}

fn read_pool() -> UsdcPoolAccountingV1 {
    let Some(bytes) = env::storage_read(POOL_KEY) else {
        return UsdcPoolAccountingV1 {
            spendable_raw: 0,
            generation: 0,
        };
    };
    borsh::from_slice(&bytes).unwrap_or_else(|_| env::panic_str("USDC pool accounting is malformed"))
}

fn write_pool(pool: &UsdcPoolAccountingV1) {
    let bytes = borsh::to_vec(pool)
        .unwrap_or_else(|_| env::panic_str("failed to serialize USDC pool accounting"));
    env::storage_write(POOL_KEY, &bytes);
}

fn read_total() -> u128 {
    let Some(bytes) = env::storage_read(QUARANTINE_TOTAL_KEY) else {
        return 0;
    };
    let bytes: [u8; 16] = bytes
        .as_slice()
        .try_into()
        .unwrap_or_else(|_| env::panic_str("USDC quarantine total is malformed"));
    u128::from_le_bytes(bytes)
}

fn write_total(total: u128) {
    if total == 0 {
        env::storage_remove(QUARANTINE_TOTAL_KEY);
        return;
    }
    env::storage_write(QUARANTINE_TOTAL_KEY, &total.to_le_bytes());
}

fn read_quarantine(commitment_id: u64) -> u128 {
    let Some(bytes) = env::storage_read(&quarantine_key(commitment_id)) else {
        return 0;
    };
    let bytes: [u8; 16] = bytes
        .as_slice()
        .try_into()
        .unwrap_or_else(|_| env::panic_str("USDC certificate quarantine is malformed"));
    u128::from_le_bytes(bytes)
}

fn write_quarantine(commitment_id: u64, amount_raw: u128) {
    if amount_raw == 0 {
        env::storage_remove(&quarantine_key(commitment_id));
        return;
    }
    env::storage_write(&quarantine_key(commitment_id), &amount_raw.to_le_bytes());
}

#[cfg(test)]
pub(crate) fn clear_for_test() {
    env::storage_remove(POOL_KEY);
    env::storage_remove(QUARANTINE_TOTAL_KEY);
    for commitment_id in 0..16 {
        env::storage_remove(&quarantine_key(commitment_id));
    }
}

fn quarantine_key(commitment_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(QUARANTINE_PREFIX.len() + 8);
    key.extend_from_slice(QUARANTINE_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key
}
