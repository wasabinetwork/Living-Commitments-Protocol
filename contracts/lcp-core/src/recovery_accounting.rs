//! Checked accounting primitives for recovery credits and storage reserves.
//!
//! The bounded persistent reserve registry and payer-credit accounting are
//! connected to the fresh-instance native cash ledger and feature-gated
//! NEP-141 recovery flow. This local candidate still needs NEAR VM and
//! independent acceptance.
#![allow(dead_code)]

use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    env,
    json_types::U128,
    AccountId,
};

use crate::native_cash::{self, NativeLiability};

const REFUND_CREDIT_VERSION: u8 = 1;
const STORAGE_RESERVE_VERSION: u8 = 1;
const STORAGE_RESERVE_KEY: &[u8] = b"lcp:recovery-storage-reserve:v1";
const STORAGE_BOND_RECORD_PREFIX: &[u8] = b"lcp:storage-bond-record:v1:";
const STORAGE_BOND_INDEX_PREFIX: &[u8] = b"lcp:storage-bond-index:v1:";
const REFUND_CREDIT_PREFIX: &[u8] = b"lcp:refund-credit:v1:";
const REFUND_CREDIT_ROW_BOND_DOMAIN: &[u8] = b"lcp:refund-credit-row-bond:v1:";
// Provisional bounded-registry cap: 32 batches at the current 64-record batch
// size. Measure receipt gas and storage costs in the NEAR VM before exposing
// any admission or maintenance entry point with this limit.
pub(crate) const MAX_STORAGE_BOND_RECORDS: u32 = 2_048;
pub(crate) const MAX_REVALUATION_BATCH: usize = 64;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) enum RefundCreditStateV1 {
    Pending,
    Available,
    Withdrawing,
    RefundPending,
}

/// A preallocated payer row. `accrued_yocto` remains a payable liability in
/// every state until an exact successful withdrawal callback is reconciled.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct RefundCreditV1 {
    version: u8,
    pub(crate) payer: AccountId,
    pub(crate) state: RefundCreditStateV1,
    pub(crate) accrued_yocto: u128,
    pub(crate) next_withdrawal_nonce: u64,
    /// Attempt fields remain present in every state, keeping serialized row
    /// size fixed after its storage bond has been measured.
    pub(crate) attempt_amount_yocto: u128,
    pub(crate) attempt_nonce: u64,
    /// A row can become Available only after it is sealed and all associated
    /// payer-backed records have been released.
    pub(crate) sealed: bool,
    pub(crate) live_bond_records: u32,
    /// Exact successful payment may arrive while storage-byte revaluation is
    /// required. In that case Q is released immediately and this fixed-size
    /// tombstone preserves the row bond until reserve maintenance can close it.
    settled: bool,
    /// The row's bond is never paid to its payer. On row deletion it moves to
    /// the treasury reserve.
    pub(crate) storage_bond_yocto: u128,
    storage_bond_record_id: [u8; 32],
}

#[cfg(feature = "usdc-receipt-recovery")]
#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptRecoveryCreditViewV1 {
    pub payer: AccountId,
    pub state: String,
    pub accrued_yocto: String,
    pub withdrawable_yocto: String,
    pub in_flight_yocto: String,
    pub withdrawal_available: bool,
    pub storage_reserve_ready: bool,
    pub cash_solvency_ready: bool,
    pub withdrawal_cash_margin_ready: bool,
    pub withdrawal_outflow_yocto: String,
    pub sealed: bool,
    pub live_bond_records: u32,
    pub settled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RefundWithdrawalV1 {
    pub(crate) amount_yocto: u128,
    pub(crate) nonce: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ClosedRefundCreditV1 {
    pub(crate) paid_yocto: u128,
    pub(crate) treasury_bond_yocto: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PersistedCreditResolutionV1 {
    Ignored,
    Failed,
    PaidAndClosed,
    PaidAwaitingReserveMaintenance,
}

impl RefundCreditV1 {
    pub(crate) fn preallocate(payer: AccountId, storage_bond_yocto: u128) -> Self {
        Self {
            version: REFUND_CREDIT_VERSION,
            payer,
            state: RefundCreditStateV1::Pending,
            accrued_yocto: 0,
            next_withdrawal_nonce: 0,
            attempt_amount_yocto: 0,
            attempt_nonce: 0,
            sealed: false,
            live_bond_records: 0,
            settled: false,
            storage_bond_yocto,
            storage_bond_record_id: [0; 32],
        }
    }

    /// Admission excess is credited before the associated operation becomes
    /// terminal. It counts toward Q immediately, even while withdrawals are
    /// still disabled by `Pending`.
    pub(crate) fn accrue_pending(&mut self, amount_yocto: u128) -> Result<(), &'static str> {
        self.ensure_version()?;
        if !matches!(&self.state, RefundCreditStateV1::Pending) || self.sealed {
            return Err("refund credit is no longer pending");
        }
        self.accrued_yocto = self
            .accrued_yocto
            .checked_add(amount_yocto)
            .ok_or("refund credit amount overflow")?;
        Ok(())
    }

    /// Adds one associated record bond once. A sealed row accepts releases
    /// for records retained during a storage-reserve shortfall, but cannot be
    /// associated with any new record.
    pub(crate) fn release_record_bond(
        &mut self,
        released_record_bond_yocto: u128,
    ) -> Result<(), &'static str> {
        self.ensure_version()?;
        if !matches!(&self.state, RefundCreditStateV1::Pending) {
            return Err("refund credit is not pending");
        }
        if self.live_bond_records == 0 {
            return Err("refund credit has no live bond records");
        }
        self.accrued_yocto = self
            .accrued_yocto
            .checked_add(released_record_bond_yocto)
            .ok_or("refund credit amount overflow")?;
        self.live_bond_records -= 1;
        if self.sealed && self.live_bond_records == 0 {
            self.state = RefundCreditStateV1::Available;
        }
        Ok(())
    }

    pub(crate) fn register_live_bond_record(&mut self) -> Result<(), &'static str> {
        self.ensure_version()?;
        if !matches!(&self.state, RefundCreditStateV1::Pending) || self.sealed {
            return Err("refund credit no longer accepts bond records");
        }
        self.live_bond_records = self
            .live_bond_records
            .checked_add(1)
            .ok_or("refund credit bond record count overflow")?;
        Ok(())
    }

    pub(crate) fn seal(&mut self) -> Result<(), &'static str> {
        self.ensure_version()?;
        if !matches!(&self.state, RefundCreditStateV1::Pending) || self.sealed {
            return Err("refund credit cannot be sealed in its current state");
        }
        self.sealed = true;
        if self.live_bond_records == 0 {
            self.state = RefundCreditStateV1::Available;
        }
        Ok(())
    }

    /// Begins a full, payer-only withdrawal. Callers must run the cash gate
    /// before persisting this transition and scheduling the transfer.
    pub(crate) fn begin_withdrawal(
        &mut self,
        caller: &AccountId,
    ) -> Result<RefundWithdrawalV1, &'static str> {
        self.ensure_version()?;
        if caller != &self.payer {
            return Err("only the refund payer may withdraw this credit");
        }
        if self.settled {
            return Err("refund credit has already been paid");
        }
        if !matches!(
            &self.state,
            RefundCreditStateV1::Available | RefundCreditStateV1::RefundPending
        ) {
            return Err("refund credit is not available for withdrawal");
        }
        if self.accrued_yocto == 0 {
            return Err("refund credit amount must be positive");
        }
        let nonce = self
            .next_withdrawal_nonce
            .checked_add(1)
            .ok_or("refund withdrawal nonce overflow")?;
        let attempt = RefundWithdrawalV1 {
            amount_yocto: self.accrued_yocto,
            nonce,
        };
        self.next_withdrawal_nonce = nonce;
        self.attempt_amount_yocto = attempt.amount_yocto;
        self.attempt_nonce = nonce;
        self.state = RefundCreditStateV1::Withdrawing;
        Ok(attempt)
    }

    /// Reconciles only the exact active attempt. `None` represents a stale,
    /// mismatched, duplicate, or unknown callback and leaves state unchanged.
    /// On success, callers must remove this row and reclassify its own storage
    /// bond as reserve capital in the same receipt.
    pub(crate) fn resolve_withdrawal(
        &mut self,
        callback_payer: &AccountId,
        amount_yocto: u128,
        nonce: u64,
        succeeded: bool,
    ) -> Result<Option<ClosedRefundCreditV1>, &'static str> {
        self.ensure_version()?;
        if callback_payer != &self.payer {
            return Ok(None);
        }
        if !matches!(&self.state, RefundCreditStateV1::Withdrawing) {
            return Ok(None);
        }
        let expected_amount = self.attempt_amount_yocto;
        let expected_nonce = self.attempt_nonce;
        if amount_yocto != expected_amount
            || nonce != expected_nonce
            || amount_yocto != self.accrued_yocto
        {
            return Ok(None);
        }
        if !succeeded {
            self.state = RefundCreditStateV1::RefundPending;
            return Ok(None);
        }

        self.accrued_yocto = 0;
        self.attempt_amount_yocto = 0;
        self.attempt_nonce = 0;
        self.settled = true;
        // The persistent callback helper removes the row and reclassifies its
        // own bond in this same receipt.
        self.state = RefundCreditStateV1::Available;
        Ok(Some(ClosedRefundCreditV1 {
            paid_yocto: expected_amount,
            treasury_bond_yocto: self.storage_bond_yocto,
        }))
    }

    fn ensure_version(&self) -> Result<(), &'static str> {
        if self.version == REFUND_CREDIT_VERSION {
            match &self.state {
                RefundCreditStateV1::Pending => {
                    if self.settled
                        || self.attempt_amount_yocto != 0
                        || self.attempt_nonce != 0
                        || self.next_withdrawal_nonce != 0
                    {
                        return Err("pending refund credit state is inconsistent");
                    }
                    if self.sealed && self.live_bond_records == 0 {
                        return Err("sealed empty refund credit was not made available");
                    }
                }
                RefundCreditStateV1::Available => {
                    if !self.sealed || self.live_bond_records != 0 {
                        return Err("available refund credit has live bond records");
                    }
                    if self.settled {
                        if self.accrued_yocto != 0
                            || self.attempt_amount_yocto != 0
                            || self.attempt_nonce != 0
                            || self.next_withdrawal_nonce == 0
                        {
                            return Err("settled refund credit state is inconsistent");
                        }
                    } else if self.attempt_amount_yocto != 0 || self.attempt_nonce != 0 {
                        return Err("available refund credit has an active attempt");
                    }
                }
                RefundCreditStateV1::Withdrawing | RefundCreditStateV1::RefundPending => {
                    if self.settled
                        || !self.sealed
                        || self.live_bond_records != 0
                        || self.accrued_yocto == 0
                        || self.attempt_amount_yocto != self.accrued_yocto
                        || self.attempt_nonce == 0
                        || self.attempt_nonce != self.next_withdrawal_nonce
                    {
                        return Err("active refund withdrawal state is inconsistent");
                    }
                }
            }
            Ok(())
        } else {
            Err("refund credit version is unsupported")
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct StorageBondV1 {
    pub(crate) original_bond_yocto: u128,
    pub(crate) storage_bytes: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
struct StorageBondRecordV1 {
    index: u32,
    bond: StorageBondV1,
    /// Fixed-width owner metadata. `owner_kind` is 0 for permanent treasury
    /// backing, 1 for a payer credit, and 2 for a credit row's own bond.
    owner_kind: u8,
    owner_id: [u8; 32],
}

const STORAGE_OWNER_TREASURY: u8 = 0;
const STORAGE_OWNER_PAYER_CREDIT: u8 = 1;
const STORAGE_OWNER_CREDIT_ROW: u8 = 2;

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct StorageReserveV1 {
    version: u8,
    pub(crate) storage_byte_cost_yocto: u128,
    pub(crate) treasury_capital_yocto: u128,
    pub(crate) total_bond_excess_yocto: u128,
    pub(crate) total_storage_gap_yocto: u128,
    pub(crate) record_count: u32,
    revaluation: Option<StorageRevaluationV1>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
struct StorageRevaluationV1 {
    target_byte_cost_yocto: u128,
    next_record_index: u32,
    revalued_bond_excess_yocto: u128,
    revalued_storage_gap_yocto: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct StorageReserveMetricsV1 {
    pub(crate) non_withdrawable_backing_yocto: u128,
    pub(crate) shortfall_yocto: u128,
    pub(crate) free_treasury_reserve_yocto: u128,
}

/// Read-only operational status for the non-withdrawable recovery storage
/// reserve and its bounded byte-cost revaluation.
#[derive(Clone, Debug, PartialEq, Eq, near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RecoveryStorageReserveViewV1 {
    pub status: String,
    pub version: u8,
    pub stored_byte_cost_yocto: U128,
    pub observed_byte_cost_yocto: U128,
    pub treasury_capital_yocto: U128,
    pub total_storage_gap_yocto: U128,
    pub non_withdrawable_backing_yocto: U128,
    pub free_treasury_reserve_yocto: U128,
    pub shortfall_yocto: U128,
    pub record_count: u32,
    pub revaluation_active: bool,
    pub revaluation_target_byte_cost_yocto: Option<U128>,
    pub next_record_index: Option<u32>,
    pub ready: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StorageBondReleaseV1 {
    Treasury,
    PayerCredit,
    CreditRowClosed {
        credit_id: [u8; 32],
        paid_yocto: u128,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde", tag = "status", rename_all = "snake_case")]
pub enum RevaluationBatchResult {
    InProgress { next_record_index: u32 },
    Complete,
    RestartRequired,
}

impl StorageReserveV1 {
    pub(crate) fn empty(storage_byte_cost_yocto: u128) -> Self {
        Self {
            version: STORAGE_RESERVE_VERSION,
            storage_byte_cost_yocto,
            treasury_capital_yocto: 0,
            total_bond_excess_yocto: 0,
            total_storage_gap_yocto: 0,
            record_count: 0,
            revaluation: None,
        }
    }

    pub(crate) fn register_record(
        &mut self,
        bond: StorageBondV1,
        observed_byte_cost_yocto: u128,
    ) -> Result<(), &'static str> {
        self.ensure_current(observed_byte_cost_yocto)?;
        if self.record_count >= MAX_STORAGE_BOND_RECORDS {
            return Err("storage bond registry is full");
        }
        let (excess, gap) = contribution(bond, self.storage_byte_cost_yocto)?;
        let next_excess = self
            .total_bond_excess_yocto
            .checked_add(excess)
            .ok_or("storage bond excess overflow")?;
        let next_gap = self
            .total_storage_gap_yocto
            .checked_add(gap)
            .ok_or("storage reserve gap overflow")?;
        let next_count = self
            .record_count
            .checked_add(1)
            .ok_or("storage bond record count overflow")?;
        let next = Self {
            total_bond_excess_yocto: next_excess,
            total_storage_gap_yocto: next_gap,
            record_count: next_count,
            ..*self
        };
        if next.metrics()?.shortfall_yocto != 0 {
            return Err("storage reserve top-up required before admission");
        }
        *self = next;
        Ok(())
    }

    /// Removes a payer-backed record and returns its original bond for one-time
    /// crediting. Do not remove the storage record unless this transition and
    /// the matching credit-row update commit atomically.
    pub(crate) fn release_payer_record(
        &mut self,
        bond: StorageBondV1,
        observed_byte_cost_yocto: u128,
    ) -> Result<u128, &'static str> {
        self.ensure_current(observed_byte_cost_yocto)?;
        if self.metrics()?.shortfall_yocto != 0 {
            return Err("storage reserve shortfall blocks bond release");
        }
        self.remove_record_contribution(bond)?;
        Ok(bond.original_bond_yocto)
    }

    /// Deletes a credit row after exact successful payment. Its own bond moves
    /// to treasury capital rather than becoming payable to the payer.
    pub(crate) fn close_credit_row(
        &mut self,
        bond: StorageBondV1,
        observed_byte_cost_yocto: u128,
    ) -> Result<(), &'static str> {
        self.ensure_current(observed_byte_cost_yocto)?;
        if self.metrics()?.shortfall_yocto != 0 {
            return Err("storage reserve shortfall blocks credit-row closure");
        }
        let next_treasury = self
            .treasury_capital_yocto
            .checked_add(bond.original_bond_yocto)
            .ok_or("storage reserve treasury overflow")?;
        self.remove_record_contribution(bond)?;
        self.treasury_capital_yocto = next_treasury;
        Ok(())
    }

    /// Payable top-ups are permitted during revaluation; the record set is
    /// still frozen until revaluation completes.
    pub(crate) fn top_up(&mut self, amount_yocto: u128) -> Result<(), &'static str> {
        self.ensure_version()?;
        self.treasury_capital_yocto = self
            .treasury_capital_yocto
            .checked_add(amount_yocto)
            .ok_or("storage reserve treasury overflow")?;
        Ok(())
    }

    pub(crate) fn metrics(&self) -> Result<StorageReserveMetricsV1, &'static str> {
        let free = self
            .treasury_capital_yocto
            .saturating_sub(self.total_storage_gap_yocto);
        let backing = self
            .total_bond_excess_yocto
            .checked_add(free)
            .ok_or("storage reserve backing overflow")?;
        Ok(StorageReserveMetricsV1 {
            non_withdrawable_backing_yocto: backing,
            shortfall_yocto: self
                .total_storage_gap_yocto
                .saturating_sub(self.treasury_capital_yocto),
            free_treasury_reserve_yocto: free,
        })
    }

    pub(crate) fn begin_revaluation(
        &mut self,
        observed_byte_cost_yocto: u128,
    ) -> Result<(), &'static str> {
        self.ensure_version()?;
        if self.revaluation.is_some() {
            return Err("storage reserve revaluation is already in progress");
        }
        if observed_byte_cost_yocto == self.storage_byte_cost_yocto {
            return Ok(());
        }
        if self.record_count == 0 {
            self.storage_byte_cost_yocto = observed_byte_cost_yocto;
            return Ok(());
        }
        self.revaluation = Some(StorageRevaluationV1 {
            target_byte_cost_yocto: observed_byte_cost_yocto,
            next_record_index: 0,
            revalued_bond_excess_yocto: 0,
            revalued_storage_gap_yocto: 0,
        });
        Ok(())
    }

    /// Adds one contiguous bounded batch from the persistent record index.
    /// While revaluation is active, callers must fail closed for admissions,
    /// releases, and native outflows.
    pub(crate) fn revalue_batch(
        &mut self,
        observed_byte_cost_yocto: u128,
        start_index: u32,
        records: &[StorageBondV1],
    ) -> Result<RevaluationBatchResult, &'static str> {
        self.ensure_version()?;
        if records.is_empty() || records.len() > MAX_REVALUATION_BATCH {
            return Err("storage reserve batch size is invalid");
        }
        let mut progress = self
            .revaluation
            .ok_or("storage reserve revaluation has not started")?;
        if observed_byte_cost_yocto != progress.target_byte_cost_yocto {
            self.revaluation = Some(StorageRevaluationV1 {
                target_byte_cost_yocto: observed_byte_cost_yocto,
                next_record_index: 0,
                revalued_bond_excess_yocto: 0,
                revalued_storage_gap_yocto: 0,
            });
            return Ok(RevaluationBatchResult::RestartRequired);
        }
        if start_index != progress.next_record_index {
            return Err("storage reserve batch is out of sequence");
        }
        let end_index = start_index
            .checked_add(u32::try_from(records.len()).map_err(|_| "batch size overflow")?)
            .ok_or("storage reserve record index overflow")?;
        if end_index > self.record_count {
            return Err("storage reserve batch exceeds record count");
        }
        for record in records {
            let (excess, gap) = contribution(*record, progress.target_byte_cost_yocto)?;
            progress.revalued_bond_excess_yocto = progress
                .revalued_bond_excess_yocto
                .checked_add(excess)
                .ok_or("storage bond excess overflow")?;
            progress.revalued_storage_gap_yocto = progress
                .revalued_storage_gap_yocto
                .checked_add(gap)
                .ok_or("storage reserve gap overflow")?;
        }
        progress.next_record_index = end_index;
        if end_index == self.record_count {
            self.storage_byte_cost_yocto = progress.target_byte_cost_yocto;
            self.total_bond_excess_yocto = progress.revalued_bond_excess_yocto;
            self.total_storage_gap_yocto = progress.revalued_storage_gap_yocto;
            self.revaluation = None;
            Ok(RevaluationBatchResult::Complete)
        } else {
            let next_record_index = progress.next_record_index;
            self.revaluation = Some(progress);
            Ok(RevaluationBatchResult::InProgress { next_record_index })
        }
    }

    pub(crate) fn is_ready(&self, observed_byte_cost_yocto: u128) -> bool {
        self.version == STORAGE_RESERVE_VERSION
            && self.revaluation.is_none()
            && self.storage_byte_cost_yocto == observed_byte_cost_yocto
            && self
                .metrics()
                .is_ok_and(|metrics| metrics.shortfall_yocto == 0)
    }

    fn ensure_current(&self, observed_byte_cost_yocto: u128) -> Result<(), &'static str> {
        self.ensure_version()?;
        if self.revaluation.is_some() || observed_byte_cost_yocto != self.storage_byte_cost_yocto {
            return Err("storage reserve must be revalued before this action");
        }
        Ok(())
    }

    fn ensure_version(&self) -> Result<(), &'static str> {
        if self.version == STORAGE_RESERVE_VERSION {
            Ok(())
        } else {
            Err("storage reserve version is unsupported")
        }
    }

    fn remove_record_contribution(&mut self, bond: StorageBondV1) -> Result<(), &'static str> {
        let (excess, gap) = contribution(bond, self.storage_byte_cost_yocto)?;
        self.total_bond_excess_yocto = self
            .total_bond_excess_yocto
            .checked_sub(excess)
            .ok_or("storage bond excess underflow")?;
        self.total_storage_gap_yocto = self
            .total_storage_gap_yocto
            .checked_sub(gap)
            .ok_or("storage reserve gap underflow")?;
        self.record_count = self
            .record_count
            .checked_sub(1)
            .ok_or("storage bond record count underflow")?;
        Ok(())
    }

    fn remove_treasury_record(
        &mut self,
        bond: StorageBondV1,
        observed_byte_cost_yocto: u128,
    ) -> Result<(), &'static str> {
        self.ensure_current(observed_byte_cost_yocto)?;
        if self.metrics()?.shortfall_yocto != 0 {
            return Err("storage reserve shortfall blocks treasury record removal");
        }
        self.remove_record_contribution(bond)?;
        self.treasury_capital_yocto = self
            .treasury_capital_yocto
            .checked_add(bond.original_bond_yocto)
            .ok_or("storage reserve treasury overflow")?;
        Ok(())
    }

    fn release_free_treasury_to_credit(
        &mut self,
        amount_yocto: u128,
        observed_byte_cost_yocto: u128,
    ) -> Result<(), &'static str> {
        self.ensure_current(observed_byte_cost_yocto)?;
        let free = self.metrics()?.free_treasury_reserve_yocto;
        if amount_yocto > free {
            return Err("storage reserve has insufficient free treasury capital");
        }
        self.treasury_capital_yocto = self
            .treasury_capital_yocto
            .checked_sub(amount_yocto)
            .ok_or("storage reserve treasury underflow")?;
        Ok(())
    }
}

/// Initializes the reserve sidecar only for a fresh contract instance.
pub(crate) fn initialize_fresh() {
    if env::storage_read(STORAGE_RESERVE_KEY).is_some() {
        env::panic_str("recovery storage reserve already initialized");
    }
    save_reserve(&StorageReserveV1::empty(
        env::storage_byte_cost().as_yoctonear(),
    ));
}

#[cfg(test)]
pub(crate) fn clear_initializer_for_test() {
    env::storage_remove(STORAGE_RESERVE_KEY);
}

/// Stops native cash flows if the reserve sidecar is absent, stale, underfunded,
/// or midway through bounded byte-cost revaluation.
pub(crate) fn assert_cash_gate_ready() {
    let reserve = load_reserve();
    if !reserve.is_ready(env::storage_byte_cost().as_yoctonear()) {
        env::panic_str("recovery storage reserve is not ready");
    }
}

/// Preallocates a payer-specific credit before asynchronous work is scheduled.
/// The supplied storage measurement must be captured immediately before the
/// row is written. The measured bond covers the row, its registry row, and its
/// registry index. Any admission excess enters Q immediately, even while the
/// credit remains Pending.
pub(crate) fn preallocate_refund_credit(
    credit_id: [u8; 32],
    payer: AccountId,
    row_bond_yocto: u128,
    admission_excess_yocto: u128,
    storage_usage_before: u64,
) -> StorageBondV1 {
    if credit_id == [0; 32] {
        env::panic_str("refund credit ID must be nonzero");
    }
    if read_refund_credit(&credit_id).is_some() {
        env::panic_str("refund credit already exists");
    }
    let row_record_id = credit_row_bond_record_id(&credit_id);
    if row_record_id == [0; 32] {
        env::panic_str("refund credit bond record ID must be nonzero");
    }
    if read_bond_record(&row_record_id).is_some() {
        env::panic_str("refund credit bond record already exists");
    }

    let mut credit = RefundCreditV1::preallocate(payer, row_bond_yocto);
    credit.storage_bond_record_id = row_record_id;
    credit
        .accrue_pending(admission_excess_yocto)
        .unwrap_or_else(|message| env::panic_str(message));
    write_refund_credit(&credit_id, &credit);

    let row_bond = register_measured_record_inner(
        row_record_id,
        Some(row_bond_yocto),
        storage_usage_before,
        STORAGE_OWNER_CREDIT_ROW,
        credit_id,
    );
    native_cash::adjust(
        NativeLiability::RecoveryCredit,
        true,
        admission_excess_yocto,
    );
    row_bond
}

/// Preallocates a payer credit whose own bond is set from the measured row,
/// registry, and index storage written by this call.
pub(crate) fn preallocate_measured_refund_credit(
    credit_id: [u8; 32],
    payer: AccountId,
    admission_excess_yocto: u128,
    storage_usage_before: u64,
) -> StorageBondV1 {
    if credit_id == [0; 32] {
        env::panic_str("refund credit ID must be nonzero");
    }
    if read_refund_credit(&credit_id).is_some() {
        env::panic_str("refund credit already exists");
    }
    let row_record_id = credit_row_bond_record_id(&credit_id);
    if row_record_id == [0; 32] || read_bond_record(&row_record_id).is_some() {
        env::panic_str("refund credit bond record already exists or is invalid");
    }

    let mut credit = RefundCreditV1::preallocate(payer, 0);
    credit.storage_bond_record_id = row_record_id;
    credit
        .accrue_pending(admission_excess_yocto)
        .unwrap_or_else(|message| env::panic_str(message));
    write_refund_credit(&credit_id, &credit);

    let row_bond = register_measured_record_inner(
        row_record_id,
        None,
        storage_usage_before,
        STORAGE_OWNER_CREDIT_ROW,
        credit_id,
    );
    let mut credit = read_refund_credit(&credit_id)
        .unwrap_or_else(|| env::panic_str("measured refund credit row disappeared"));
    credit.storage_bond_yocto = row_bond.original_bond_yocto;
    write_refund_credit(&credit_id, &credit);
    native_cash::adjust(
        NativeLiability::RecoveryCredit,
        true,
        admission_excess_yocto,
    );
    row_bond
}

/// Registers permanent protocol-owned storage such as a reserve/configuration
/// record. These records have no payer-credit destination.
pub(crate) fn register_measured_record(
    record_id: [u8; 32],
    original_bond_yocto: u128,
    storage_usage_before: u64,
) -> StorageBondV1 {
    register_measured_record_inner(
        record_id,
        Some(original_bond_yocto),
        storage_usage_before,
        STORAGE_OWNER_TREASURY,
        [0; 32],
    )
}

/// Registers a payer-funded business record and binds it to an already
/// preallocated, unsealed credit row. The record's measured bond is not a Q
/// liability while its storage remains live.
pub(crate) fn register_payer_measured_record(
    record_id: [u8; 32],
    credit_id: [u8; 32],
    original_bond_yocto: u128,
    storage_usage_before: u64,
) -> StorageBondV1 {
    register_measured_record_inner(
        record_id,
        Some(original_bond_yocto),
        storage_usage_before,
        STORAGE_OWNER_PAYER_CREDIT,
        credit_id,
    )
}

/// Registers a payer-backed business record using its measured current storage
/// cost as the refundable original bond.
pub(crate) fn register_payer_measured_record_auto(
    record_id: [u8; 32],
    credit_id: [u8; 32],
    storage_usage_before: u64,
) -> StorageBondV1 {
    register_measured_record_inner(
        record_id,
        None,
        storage_usage_before,
        STORAGE_OWNER_PAYER_CREDIT,
        credit_id,
    )
}

fn register_measured_record_inner(
    record_id: [u8; 32],
    original_bond_yocto: Option<u128>,
    storage_usage_before: u64,
    owner_kind: u8,
    owner_id: [u8; 32],
) -> StorageBondV1 {
    let byte_cost = env::storage_byte_cost().as_yoctonear();
    let mut reserve = load_reserve();
    if !reserve.is_ready(byte_cost) {
        env::panic_str("recovery storage reserve is not ready for admission");
    }
    if read_bond_record(&record_id).is_some() {
        env::panic_str("storage bond record already exists");
    }
    if reserve.record_count >= MAX_STORAGE_BOND_RECORDS {
        env::panic_str("storage bond registry is full");
    }
    let linked_credit = match owner_kind {
        STORAGE_OWNER_TREASURY => {
            if owner_id != [0; 32] {
                env::panic_str("treasury storage record has an invalid owner ID");
            }
            None
        }
        STORAGE_OWNER_PAYER_CREDIT => {
            let mut credit = read_refund_credit(&owner_id)
                .unwrap_or_else(|| env::panic_str("payer refund credit was not preallocated"));
            credit
                .register_live_bond_record()
                .unwrap_or_else(|message| env::panic_str(message));
            Some(credit)
        }
        STORAGE_OWNER_CREDIT_ROW => {
            let credit = read_refund_credit(&owner_id)
                .unwrap_or_else(|| env::panic_str("refund credit row was not preallocated"));
            if credit.storage_bond_record_id != record_id {
                env::panic_str("refund credit bond record ID does not match its row");
            }
            None
        }
        _ => env::panic_str("storage bond record owner kind is invalid"),
    };

    let index = reserve.record_count;
    let mut record = StorageBondRecordV1 {
        index,
        bond: StorageBondV1 {
            original_bond_yocto: original_bond_yocto.unwrap_or(0),
            storage_bytes: 0,
        },
        owner_kind,
        owner_id,
    };
    if let Some(credit) = linked_credit.as_ref() {
        write_refund_credit(&owner_id, credit);
    }
    write_bond_record(&record_id, &record);
    write_bond_index(index, &record_id);
    let storage_bytes = env::storage_usage()
        .checked_sub(storage_usage_before)
        .filter(|bytes| *bytes > 0)
        .unwrap_or_else(|| env::panic_str("storage bond measurement is invalid"));
    record.bond.storage_bytes = storage_bytes;
    if original_bond_yocto.is_none() {
        record.bond.original_bond_yocto = measured_storage_cost(storage_bytes);
    }
    write_bond_record(&record_id, &record);

    reserve
        .register_record(record.bond, byte_cost)
        .unwrap_or_else(|message| env::panic_str(message));
    save_reserve(&reserve);
    sync_native_cash_reserve(&reserve);
    record.bond
}

/// Seals a credit at its parent operation's terminal boundary. It becomes
/// Available immediately if no linked business records remain; otherwise the
/// last exact record release performs that transition.
pub(crate) fn seal_refund_credit(credit_id: [u8; 32]) {
    let mut credit = read_refund_credit(&credit_id)
        .unwrap_or_else(|| env::panic_str("refund credit was not preallocated"));
    credit
        .seal()
        .unwrap_or_else(|message| env::panic_str(message));
    write_refund_credit(&credit_id, &credit);
}

/// Reads a persisted refund row for an eventual view or internal lifecycle
/// caller. It performs version validation before returning the row.
pub(crate) fn read_persisted_refund_credit(credit_id: &[u8; 32]) -> Option<RefundCreditV1> {
    read_refund_credit(credit_id)
}

#[cfg(feature = "usdc-receipt-recovery")]
pub(crate) fn persisted_refund_credit_view(
    credit_id: &[u8; 32],
) -> Option<ReceiptRecoveryCreditViewV1> {
    let credit = read_refund_credit(credit_id)?;
    let reserve_ready = storage_reserve_ready();
    let cash_ready = native_cash::solvency_snapshot_ready();
    let state = match &credit.state {
        RefundCreditStateV1::Pending => "pending",
        RefundCreditStateV1::Available => "available",
        RefundCreditStateV1::Withdrawing => "withdrawing",
        RefundCreditStateV1::RefundPending => "refund_pending",
    };
    let credit_releasable = matches!(
        &credit.state,
        RefundCreditStateV1::Available | RefundCreditStateV1::RefundPending
    ) && !credit.settled
        && credit.accrued_yocto > 0;
    let withdrawal_outflow = if credit_releasable {
        credit.accrued_yocto
    } else {
        0
    };
    let withdrawal_cash_ready =
        native_cash::solvency_snapshot_ready_with_outflow(withdrawal_outflow);
    let withdrawable = credit_releasable && reserve_ready && withdrawal_cash_ready;
    let in_flight_yocto = if matches!(&credit.state, RefundCreditStateV1::Withdrawing) {
        credit.attempt_amount_yocto
    } else {
        0
    };

    Some(ReceiptRecoveryCreditViewV1 {
        payer: credit.payer,
        state: state.to_owned(),
        accrued_yocto: credit.accrued_yocto.to_string(),
        withdrawable_yocto: if withdrawable {
            credit.accrued_yocto.to_string()
        } else {
            "0".to_owned()
        },
        in_flight_yocto: in_flight_yocto.to_string(),
        withdrawal_available: withdrawable,
        storage_reserve_ready: reserve_ready,
        cash_solvency_ready: cash_ready,
        withdrawal_cash_margin_ready: withdrawal_cash_ready,
        withdrawal_outflow_yocto: withdrawal_outflow.to_string(),
        sealed: credit.sealed,
        live_bond_records: credit.live_bond_records,
        settled: credit.settled,
    })
}

/// Adds excess attached NEAR to a preallocated credit. The caller must include
/// this value in the exact amount already present in the contract balance.
pub(crate) fn accrue_persisted_refund_credit(credit_id: [u8; 32], amount_yocto: u128) {
    if amount_yocto == 0 {
        return;
    }
    let mut credit = read_refund_credit(&credit_id)
        .unwrap_or_else(|| env::panic_str("payer refund credit was not preallocated"));
    credit
        .accrue_pending(amount_yocto)
        .unwrap_or_else(|message| env::panic_str(message));
    write_refund_credit(&credit_id, &credit);
    native_cash::adjust(NativeLiability::RecoveryCredit, true, amount_yocto);
}

pub(crate) fn storage_reserve_ready() -> bool {
    load_reserve().is_ready(env::storage_byte_cost().as_yoctonear())
}

/// Persists the payer-only whole-row attempt and reserves its outgoing value
/// in X. The public method that calls this helper must create exactly one
/// transfer for the returned amount and run the final cash gate afterward.
pub(crate) fn begin_persisted_refund_withdrawal(credit_id: [u8; 32]) -> RefundWithdrawalV1 {
    native_cash::assert_solvency();
    let caller = env::predecessor_account_id();
    let mut credit = read_refund_credit(&credit_id)
        .unwrap_or_else(|| env::panic_str("refund credit does not exist"));
    let attempt = credit
        .begin_withdrawal(&caller)
        .unwrap_or_else(|message| env::panic_str(message));
    write_refund_credit(&credit_id, &credit);
    native_cash::record_outflow(attempt.amount_yocto);
    attempt
}

/// Reconciles the exact private callback for a persisted payer-credit attempt.
/// A successful transfer releases Q immediately. If a storage-price change or
/// active revaluation prevents row removal, the zero-credit row remains as a
/// settled tombstone until `finalize_settled_refund_credit` can reclassify its
/// own bond without risking a second payment. Callers must not append a
/// panic-only cash gate after a confirmed transfer; any storage staleness keeps
/// all subsequent outflows paused by the ordinary gate.
pub(crate) fn resolve_persisted_refund_withdrawal(
    credit_id: [u8; 32],
    amount_yocto: u128,
    nonce: u64,
) -> PersistedCreditResolutionV1 {
    if env::predecessor_account_id() != env::current_account_id() {
        return PersistedCreditResolutionV1::Ignored;
    }
    if env::promise_results_count() != 1 {
        return PersistedCreditResolutionV1::Ignored;
    }
    // A NEAR native transfer returns no payload. Bound the read to zero bytes
    // so a malformed or unexpected large callback result cannot exhaust gas.
    let succeeded = match env::promise_result_checked(0, 0) {
        Ok(_) => true,
        Err(near_sdk::PromiseError::Failed) => false,
        // The native transfer contract expects no result bytes. An unexpected
        // payload is ambiguous for this exact attempt, so preserve its
        // Withdrawing liability and forbid a retry instead of risking a second
        // payment. The generic callback helper intentionally treats successful
        // oversized payloads as paid because those transfers are irreversible.
        Err(near_sdk::PromiseError::TooLong(_)) => return PersistedCreditResolutionV1::Ignored,
        Err(_) => return PersistedCreditResolutionV1::Ignored,
    };
    let Some(mut credit) = read_refund_credit(&credit_id) else {
        return PersistedCreditResolutionV1::Ignored;
    };
    let before = credit.clone();
    let row_payer = credit.payer.clone();
    let closed = credit
        .resolve_withdrawal(&row_payer, amount_yocto, nonce, succeeded)
        .unwrap_or_else(|message| env::panic_str(message));
    let closed = match closed {
        Some(closed) => closed,
        None if credit != before => {
            write_refund_credit(&credit_id, &credit);
            return PersistedCreditResolutionV1::Failed;
        }
        None => return PersistedCreditResolutionV1::Ignored,
    };

    let byte_cost = env::storage_byte_cost().as_yoctonear();
    if load_reserve().is_ready(byte_cost) {
        let before_remove = env::storage_usage();
        env::storage_remove(&refund_credit_key(&credit_id));
        remove_measured_record(
            credit.storage_bond_record_id,
            before_remove,
            StorageBondReleaseV1::CreditRowClosed {
                credit_id,
                paid_yocto: closed.paid_yocto,
            },
        );
        PersistedCreditResolutionV1::PaidAndClosed
    } else {
        write_refund_credit(&credit_id, &credit);
        native_cash::adjust(NativeLiability::RecoveryCredit, false, closed.paid_yocto);
        PersistedCreditResolutionV1::PaidAwaitingReserveMaintenance
    }
}

/// Closes a successful zero-balance row retained during an interrupted or
/// stale-price reserve revaluation. It cannot transfer funds or alter Q.
pub(crate) fn finalize_settled_refund_credit(credit_id: [u8; 32]) -> bool {
    let Some(credit) = read_refund_credit(&credit_id) else {
        return false;
    };
    if !credit.settled
        || credit.accrued_yocto != 0
        || !matches!(credit.state, RefundCreditStateV1::Available)
    {
        return false;
    }
    if !load_reserve().is_ready(env::storage_byte_cost().as_yoctonear()) {
        return false;
    }
    let before_remove = env::storage_usage();
    env::storage_remove(&refund_credit_key(&credit_id));
    remove_measured_record(
        credit.storage_bond_record_id,
        before_remove,
        StorageBondReleaseV1::CreditRowClosed {
            credit_id,
            paid_yocto: 0,
        },
    );
    true
}

/// Closes an available zero-value row that has no records or refund to pay.
/// Its own bond is moved to treasury reserve; no promise or Q adjustment occurs.
pub(crate) fn finalize_empty_refund_credit(credit_id: [u8; 32]) -> bool {
    let Some(credit) = read_refund_credit(&credit_id) else {
        return false;
    };
    if credit.settled
        || credit.accrued_yocto != 0
        || credit.live_bond_records != 0
        || !credit.sealed
        || !matches!(credit.state, RefundCreditStateV1::Available)
        || !load_reserve().is_ready(env::storage_byte_cost().as_yoctonear())
    {
        return false;
    }
    let before_remove = env::storage_usage();
    env::storage_remove(&refund_credit_key(&credit_id));
    remove_measured_record(
        credit.storage_bond_record_id,
        before_remove,
        StorageBondReleaseV1::CreditRowClosed {
            credit_id,
            paid_yocto: 0,
        },
    );
    true
}

/// Removes a business record and its registry row after the caller has deleted
/// the business storage. `storage_usage_before` is captured immediately before
/// that deletion so the complete measured byte delta can be checked. The linked
/// preallocated row and aggregate `RecoveryCredit` liability are updated here,
/// atomically with reserve release, so callers cannot omit or duplicate Q.
pub(crate) fn remove_measured_record(
    record_id: [u8; 32],
    storage_usage_before: u64,
    release: StorageBondReleaseV1,
) -> StorageBondV1 {
    let byte_cost = env::storage_byte_cost().as_yoctonear();
    let mut reserve = load_reserve();
    if !reserve.is_ready(byte_cost) {
        env::panic_str("recovery storage reserve is not ready for release");
    }
    let record = read_bond_record(&record_id)
        .unwrap_or_else(|| env::panic_str("storage bond record is missing"));
    let id_at_index = read_bond_index(record.index)
        .unwrap_or_else(|| env::panic_str("storage bond index entry is missing"));
    if id_at_index != record_id {
        env::panic_str("storage bond index does not match its record");
    }

    match release {
        StorageBondReleaseV1::Treasury => {
            if record.owner_kind != STORAGE_OWNER_TREASURY || record.owner_id != [0; 32] {
                env::panic_str("storage bond record is not treasury-owned");
            }
            reserve
                .remove_treasury_record(record.bond, byte_cost)
                .unwrap_or_else(|message| env::panic_str(message));
        }
        StorageBondReleaseV1::PayerCredit => {
            if record.owner_kind != STORAGE_OWNER_PAYER_CREDIT {
                env::panic_str("storage bond record is not linked to a payer credit");
            }
            let mut credit = read_refund_credit(&record.owner_id)
                .unwrap_or_else(|| env::panic_str("linked payer refund credit is missing"));
            credit
                .release_record_bond(record.bond.original_bond_yocto)
                .unwrap_or_else(|message| env::panic_str(message));
            reserve
                .release_payer_record(record.bond, byte_cost)
                .unwrap_or_else(|message| env::panic_str(message));
            write_refund_credit(&record.owner_id, &credit);
        }
        StorageBondReleaseV1::CreditRowClosed {
            credit_id,
            paid_yocto: _,
        } => {
            if record.owner_kind != STORAGE_OWNER_CREDIT_ROW || record.owner_id != credit_id {
                env::panic_str("storage bond record is not the selected refund credit row");
            }
            if read_refund_credit(&credit_id).is_some() {
                env::panic_str("refund credit row must be removed before closing its bond");
            }
            reserve
                .close_credit_row(record.bond, byte_cost)
                .unwrap_or_else(|message| env::panic_str(message));
        }
    }
    remove_bond_record_and_compact(record_id, record);
    let removed_bytes = storage_usage_before
        .checked_sub(env::storage_usage())
        .unwrap_or_else(|| env::panic_str("storage bond release increased storage usage"));
    if removed_bytes != record.bond.storage_bytes {
        env::panic_str("storage bond release did not match measured storage");
    }

    save_reserve(&reserve);
    sync_native_cash_reserve(&reserve);
    match release {
        StorageBondReleaseV1::Treasury => {}
        StorageBondReleaseV1::PayerCredit => native_cash::adjust(
            NativeLiability::RecoveryCredit,
            true,
            record.bond.original_bond_yocto,
        ),
        StorageBondReleaseV1::CreditRowClosed { paid_yocto: 0, .. } => {}
        StorageBondReleaseV1::CreditRowClosed { paid_yocto, .. } => {
            native_cash::adjust(NativeLiability::RecoveryCredit, false, paid_yocto)
        }
    }
    record.bond
}

/// Returns bounded storage metrics for admission planning. Callers must still
/// use the checked registration path and run the native cash gate afterward.
pub(crate) fn storage_reserve_view() -> RecoveryStorageReserveViewV1 {
    let reserve = load_reserve();
    let observed_byte_cost = env::storage_byte_cost().as_yoctonear();
    let metrics = reserve
        .metrics()
        .unwrap_or_else(|message| env::panic_str(message));
    let ready = reserve.is_ready(observed_byte_cost);
    let status = if reserve.revaluation.is_some() {
        "revaluating"
    } else if reserve.storage_byte_cost_yocto != observed_byte_cost {
        "stale"
    } else if metrics.shortfall_yocto != 0 {
        "shortfall"
    } else {
        "ready"
    };
    RecoveryStorageReserveViewV1 {
        status: status.to_string(),
        version: reserve.version,
        stored_byte_cost_yocto: U128(reserve.storage_byte_cost_yocto),
        observed_byte_cost_yocto: U128(observed_byte_cost),
        treasury_capital_yocto: U128(reserve.treasury_capital_yocto),
        total_storage_gap_yocto: U128(reserve.total_storage_gap_yocto),
        non_withdrawable_backing_yocto: U128(metrics.non_withdrawable_backing_yocto),
        free_treasury_reserve_yocto: U128(metrics.free_treasury_reserve_yocto),
        shortfall_yocto: U128(metrics.shortfall_yocto),
        record_count: reserve.record_count,
        revaluation_active: reserve.revaluation.is_some(),
        revaluation_target_byte_cost_yocto: reserve
            .revaluation
            .map(|progress| U128(progress.target_byte_cost_yocto)),
        next_record_index: reserve
            .revaluation
            .map(|progress| progress.next_record_index),
        ready,
    }
}

pub(crate) fn storage_bond_record_count() -> u32 {
    load_reserve().record_count
}

/// Converts free treasury storage reserve into a payer credit after measured
/// storage has been released. The credit and reserve transition are atomic.
pub(crate) fn credit_released_storage_to_payer(credit_id: [u8; 32], amount_yocto: u128) {
    if amount_yocto == 0 {
        return;
    }
    let byte_cost = env::storage_byte_cost().as_yoctonear();
    let mut reserve = load_reserve();
    reserve
        .release_free_treasury_to_credit(amount_yocto, byte_cost)
        .unwrap_or_else(|message| env::panic_str(message));
    let mut credit = read_refund_credit(&credit_id)
        .unwrap_or_else(|| env::panic_str("payer refund credit was not preallocated"));
    credit
        .accrue_pending(amount_yocto)
        .unwrap_or_else(|message| env::panic_str(message));
    write_refund_credit(&credit_id, &credit);
    save_reserve(&reserve);
    sync_native_cash_reserve(&reserve);
    native_cash::adjust(NativeLiability::RecoveryCredit, true, amount_yocto);
}

pub(crate) fn measured_storage_cost(storage_bytes: u64) -> u128 {
    env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(storage_bytes))
        .unwrap_or_else(|| env::panic_str("measured storage cost overflow"))
}

/// Begins bounded revaluation when NEAR changes the storage byte cost. Cash
/// actions remain paused until every indexed record has been processed.
pub(crate) fn begin_storage_revaluation() -> bool {
    let mut reserve = load_reserve();
    reserve
        .begin_revaluation(env::storage_byte_cost().as_yoctonear())
        .unwrap_or_else(|message| env::panic_str(message));
    let revaluation_started = reserve.revaluation.is_some();
    save_reserve(&reserve);
    sync_native_cash_reserve(&reserve);
    revaluation_started
}

/// Creates a stale stored byte-price precondition for local Sandbox acceptance.
/// This does not alter the chain's storage price and is never compiled for a
/// deployment artifact.
#[cfg(feature = "sandbox-callback-fixture")]
pub(crate) fn sandbox_mark_storage_price_stale() {
    let mut reserve = load_reserve();
    let byte_cost = env::storage_byte_cost().as_yoctonear();
    reserve.storage_byte_cost_yocto = byte_cost
        .checked_sub(1)
        .unwrap_or_else(|| env::panic_str("Sandbox storage byte cost cannot be zero"));
    save_reserve(&reserve);
    sync_native_cash_reserve(&reserve);
}

/// Adds externally attached NEAR to the non-withdrawable reserve. Partial
/// top-ups remain credited even when they do not yet clear a storage deficit.
pub(crate) fn top_up_storage_reserve(amount_yocto: u128) {
    if amount_yocto == 0 {
        env::panic_str("storage reserve top-up must be positive");
    }
    let mut reserve = load_reserve();
    reserve
        .top_up(amount_yocto)
        .unwrap_or_else(|message| env::panic_str(message));
    save_reserve(&reserve);
    sync_native_cash_reserve(&reserve);
}

/// Revalues at most `limit` indexed records. This is an internal primitive for
/// the permissionless maintenance entry point added with recovery integration.
pub(crate) fn revalue_storage_batch(start_index: u32, limit: u8) -> RevaluationBatchResult {
    let mut reserve = load_reserve();
    let limit = usize::from(limit);
    if limit == 0 || limit > MAX_REVALUATION_BATCH {
        env::panic_str("storage reserve revaluation batch size is invalid");
    }
    let observed_byte_cost = env::storage_byte_cost().as_yoctonear();
    if reserve.revaluation.is_none() && reserve.is_ready(observed_byte_cost) {
        if start_index <= reserve.record_count {
            return RevaluationBatchResult::Complete;
        }
        env::panic_str("storage reserve revaluation cursor exceeds record count");
    }
    let end_index = start_index
        .checked_add(u32::try_from(limit).unwrap_or_else(|_| env::panic_str("batch size overflow")))
        .unwrap_or_else(|| env::panic_str("storage reserve record index overflow"))
        .min(reserve.record_count);
    if start_index >= end_index {
        env::panic_str("storage reserve revaluation range is empty before completion");
    }

    let mut records = Vec::with_capacity((end_index - start_index) as usize);
    for index in start_index..end_index {
        let id = read_bond_index(index)
            .unwrap_or_else(|| env::panic_str("storage bond index entry is missing"));
        let record = read_bond_record(&id)
            .unwrap_or_else(|| env::panic_str("storage bond record is missing"));
        if record.index != index {
            env::panic_str("storage bond record index is inconsistent");
        }
        records.push(record.bond);
    }

    let result = reserve
        .revalue_batch(observed_byte_cost, start_index, &records)
        .unwrap_or_else(|message| env::panic_str(message));
    save_reserve(&reserve);
    sync_native_cash_reserve(&reserve);
    result
}

fn load_reserve() -> StorageReserveV1 {
    let bytes = env::storage_read(STORAGE_RESERVE_KEY)
        .unwrap_or_else(|| env::panic_str("recovery storage reserve is not initialized"));
    let reserve: StorageReserveV1 = near_sdk::borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("recovery storage reserve is malformed"));
    if reserve.version != STORAGE_RESERVE_VERSION {
        env::panic_str("recovery storage reserve version is unsupported");
    }
    reserve
}

fn read_refund_credit(credit_id: &[u8; 32]) -> Option<RefundCreditV1> {
    let bytes = env::storage_read(&refund_credit_key(credit_id))?;
    let credit: RefundCreditV1 = near_sdk::borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("refund credit row is malformed"));
    credit
        .ensure_version()
        .unwrap_or_else(|message| env::panic_str(message));
    if credit.storage_bond_record_id == [0; 32] {
        env::panic_str("refund credit storage bond record ID is missing");
    }
    Some(credit)
}

fn write_refund_credit(credit_id: &[u8; 32], credit: &RefundCreditV1) {
    credit
        .ensure_version()
        .unwrap_or_else(|message| env::panic_str(message));
    if credit.storage_bond_record_id == [0; 32] {
        env::panic_str("refund credit storage bond record ID is missing");
    }
    let bytes = near_sdk::borsh::to_vec(credit)
        .unwrap_or_else(|_| env::panic_str("failed to serialize refund credit row"));
    env::storage_write(&refund_credit_key(credit_id), &bytes);
}

fn save_reserve(reserve: &StorageReserveV1) {
    let bytes = near_sdk::borsh::to_vec(reserve)
        .unwrap_or_else(|_| env::panic_str("failed to serialize recovery storage reserve"));
    env::storage_write(STORAGE_RESERVE_KEY, &bytes);
}

fn sync_native_cash_reserve(reserve: &StorageReserveV1) {
    let metrics = reserve
        .metrics()
        .unwrap_or_else(|message| env::panic_str(message));
    let mut cash = native_cash::load();
    cash.storage_backing = metrics.non_withdrawable_backing_yocto;
    cash.storage_shortfall = metrics.shortfall_yocto;
    native_cash::save(&cash);
}

fn read_bond_record(record_id: &[u8; 32]) -> Option<StorageBondRecordV1> {
    let bytes = env::storage_read(&bond_record_key(record_id))?;
    Some(
        near_sdk::borsh::from_slice(&bytes)
            .unwrap_or_else(|_| env::panic_str("storage bond record is malformed")),
    )
}

fn write_bond_record(record_id: &[u8; 32], record: &StorageBondRecordV1) {
    let bytes = near_sdk::borsh::to_vec(record)
        .unwrap_or_else(|_| env::panic_str("failed to serialize storage bond record"));
    env::storage_write(&bond_record_key(record_id), &bytes);
}

fn read_bond_index(index: u32) -> Option<[u8; 32]> {
    let bytes = env::storage_read(&bond_index_key(index))?;
    Some(
        bytes
            .as_slice()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("storage bond index is malformed")),
    )
}

fn write_bond_index(index: u32, record_id: &[u8; 32]) {
    env::storage_write(&bond_index_key(index), record_id);
}

fn refund_credit_key(credit_id: &[u8; 32]) -> Vec<u8> {
    let mut key = Vec::with_capacity(REFUND_CREDIT_PREFIX.len() + credit_id.len());
    key.extend_from_slice(REFUND_CREDIT_PREFIX);
    key.extend_from_slice(credit_id);
    key
}

fn credit_row_bond_record_id(credit_id: &[u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(REFUND_CREDIT_ROW_BOND_DOMAIN.len() + credit_id.len());
    preimage.extend_from_slice(REFUND_CREDIT_ROW_BOND_DOMAIN);
    preimage.extend_from_slice(credit_id);
    env::sha256(&preimage)
        .try_into()
        .unwrap_or_else(|_| env::panic_str("credit row bond ID has an invalid length"))
}

fn remove_bond_record_and_compact(record_id: [u8; 32], record: StorageBondRecordV1) {
    let reserve = load_reserve();
    let actual_last = reserve
        .record_count
        .checked_sub(1)
        .unwrap_or_else(|| env::panic_str("storage bond record count underflow"));
    if record.index > actual_last {
        env::panic_str("storage bond record index is out of range");
    }
    if record.index != actual_last {
        let moved_id = read_bond_index(actual_last)
            .unwrap_or_else(|| env::panic_str("last storage bond index is missing"));
        let mut moved = read_bond_record(&moved_id)
            .unwrap_or_else(|| env::panic_str("last storage bond record is missing"));
        if moved.index != actual_last {
            env::panic_str("last storage bond record index is inconsistent");
        }
        moved.index = record.index;
        write_bond_record(&moved_id, &moved);
        write_bond_index(record.index, &moved_id);
    }
    env::storage_remove(&bond_index_key(actual_last));
    env::storage_remove(&bond_record_key(&record_id));
}

fn bond_record_key(record_id: &[u8; 32]) -> Vec<u8> {
    let mut key = Vec::with_capacity(STORAGE_BOND_RECORD_PREFIX.len() + record_id.len());
    key.extend_from_slice(STORAGE_BOND_RECORD_PREFIX);
    key.extend_from_slice(record_id);
    key
}

fn bond_index_key(index: u32) -> Vec<u8> {
    let mut key = Vec::with_capacity(STORAGE_BOND_INDEX_PREFIX.len() + 4);
    key.extend_from_slice(STORAGE_BOND_INDEX_PREFIX);
    key.extend_from_slice(&index.to_le_bytes());
    key
}

fn contribution(
    bond: StorageBondV1,
    storage_byte_cost_yocto: u128,
) -> Result<(u128, u128), &'static str> {
    let current_lock = storage_byte_cost_yocto
        .checked_mul(u128::from(bond.storage_bytes))
        .ok_or("storage record lock overflow")?;
    Ok((
        bond.original_bond_yocto.saturating_sub(current_lock),
        current_lock.saturating_sub(bond.original_bond_yocto),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{accounts, VMContextBuilder},
        testing_env, NearToken,
    };

    fn bond(bond: u128, bytes: u64) -> StorageBondV1 {
        StorageBondV1 {
            original_bond_yocto: bond,
            storage_bytes: bytes,
        }
    }

    fn initialize_storage_state() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .account_balance(NearToken::from_yoctonear(10_u128.pow(30)))
            .build());
        native_cash::initialize_fresh();
        initialize_fresh();
    }

    #[test]
    #[should_panic(expected = "recovery storage reserve already initialized")]
    fn fresh_storage_reserve_rejects_reinitialization() {
        initialize_storage_state();
        initialize_fresh();
    }

    #[test]
    fn storage_reserve_view_reports_revaluation_progress_and_completion() {
        initialize_storage_state();
        let before = env::storage_usage();
        env::storage_write(b"fixture:reserve-view-record", &[8; 64]);
        register_measured_record([19; 32], 10_u128.pow(26), before);

        let current_byte_cost = env::storage_byte_cost().as_yoctonear();
        let mut reserve = load_reserve();
        reserve.storage_byte_cost_yocto = current_byte_cost.saturating_sub(1);
        save_reserve(&reserve);
        assert_eq!(storage_reserve_view().status, "stale");

        assert!(begin_storage_revaluation());
        let progress = storage_reserve_view();
        assert_eq!(progress.status, "revaluating");
        assert_eq!(progress.record_count, 1);
        assert_eq!(progress.next_record_index, Some(0));
        assert_eq!(
            progress.revaluation_target_byte_cost_yocto,
            Some(U128(current_byte_cost))
        );
        assert!(!progress.ready);

        assert_eq!(
            revalue_storage_batch(0, 64),
            RevaluationBatchResult::Complete
        );
        let ready = storage_reserve_view();
        assert_eq!(ready.status, "ready");
        assert_eq!(ready.next_record_index, None);
        assert!(ready.ready);

        // A repeated maintenance call is an idempotent completion check.
        assert_eq!(
            revalue_storage_batch(ready.record_count, 64),
            RevaluationBatchResult::Complete
        );
    }

    #[test]
    fn storage_reserve_view_reports_shortfall_without_panicking() {
        initialize_storage_state();
        let mut reserve = load_reserve();
        reserve.total_storage_gap_yocto = 1;
        reserve.treasury_capital_yocto = 0;
        save_reserve(&reserve);

        let view = storage_reserve_view();
        assert_eq!(view.status, "shortfall");
        assert_eq!(view.shortfall_yocto, U128(1));
        assert!(!view.ready);
    }

    #[test]
    fn empty_storage_revaluation_reports_complete_when_reserve_is_ready() {
        initialize_storage_state();
        let observed_byte_cost = env::storage_byte_cost().as_yoctonear();
        let mut reserve = load_reserve();
        reserve.storage_byte_cost_yocto = observed_byte_cost.saturating_sub(1);
        save_reserve(&reserve);

        // Empty registries can update their stored price immediately, without
        // entering a paused revaluation that has no records to process.
        assert!(!begin_storage_revaluation());
        assert_eq!(storage_reserve_view().status, "ready");
        assert_eq!(
            revalue_storage_batch(0, 64),
            RevaluationBatchResult::Complete
        );
    }

    #[test]
    fn refund_credit_remains_liability_until_exact_success() {
        let payer = accounts(0);
        let other = accounts(1);
        let mut credit = RefundCreditV1::preallocate(payer.clone(), 7);
        credit.accrue_pending(11).unwrap();
        assert_eq!(credit.accrued_yocto, 11);
        assert!(credit.begin_withdrawal(&payer).is_err());

        credit.register_live_bond_record().unwrap();
        credit.seal().unwrap();
        credit.release_record_bond(13).unwrap();
        assert_eq!(credit.accrued_yocto, 24);
        assert!(credit.begin_withdrawal(&other).is_err());
        let attempt = credit.begin_withdrawal(&payer).unwrap();
        assert_eq!(attempt.amount_yocto, 24);
        assert_eq!(attempt.nonce, 1);

        assert_eq!(
            credit
                .resolve_withdrawal(&payer, 23, attempt.nonce, true)
                .unwrap(),
            None
        );
        assert_eq!(credit.accrued_yocto, 24);
        assert_eq!(
            credit
                .resolve_withdrawal(&other, 24, attempt.nonce, true)
                .unwrap(),
            None
        );
        assert_eq!(credit.accrued_yocto, 24);

        assert_eq!(
            credit
                .resolve_withdrawal(&payer, 24, attempt.nonce, false)
                .unwrap(),
            None
        );
        assert_eq!(credit.accrued_yocto, 24);
        assert!(matches!(&credit.state, RefundCreditStateV1::RefundPending));

        let retry = credit.begin_withdrawal(&payer).unwrap();
        assert_eq!(retry.amount_yocto, 24);
        assert_eq!(retry.nonce, 2);
        let closed = credit
            .resolve_withdrawal(&payer, retry.amount_yocto, retry.nonce, true)
            .unwrap()
            .unwrap();
        assert_eq!(closed.paid_yocto, 24);
        assert_eq!(closed.treasury_bond_yocto, 7);
        assert_eq!(credit.accrued_yocto, 0);
        assert!(credit.begin_withdrawal(&payer).is_err());
        assert_eq!(
            credit
                .resolve_withdrawal(&payer, retry.amount_yocto, retry.nonce, true)
                .unwrap(),
            None
        );
    }

    #[test]
    fn refund_credit_rejects_nonce_overflow_without_mutating_state() {
        let payer = accounts(0);
        let mut credit = RefundCreditV1::preallocate(payer.clone(), 1);
        credit.register_live_bond_record().unwrap();
        credit.seal().unwrap();
        credit.release_record_bond(5).unwrap();
        credit.next_withdrawal_nonce = u64::MAX;
        let before = credit.clone();
        assert_eq!(
            credit.begin_withdrawal(&payer),
            Err("refund withdrawal nonce overflow")
        );
        assert_eq!(credit, before);
    }

    #[test]
    fn storage_reserve_tracks_per_record_excess_gap_and_topups() {
        let mut reserve = StorageReserveV1::empty(2);
        reserve.register_record(bond(30, 10), 2).unwrap(); // O = 10.
        reserve.top_up(8).unwrap();
        reserve.register_record(bond(12, 10), 2).unwrap(); // G = 8.
        assert_eq!(
            reserve.metrics().unwrap(),
            StorageReserveMetricsV1 {
                non_withdrawable_backing_yocto: 10,
                shortfall_yocto: 0,
                free_treasury_reserve_yocto: 0,
            }
        );
        assert!(reserve.is_ready(2));

        let released = reserve.release_payer_record(bond(30, 10), 2).unwrap();
        assert_eq!(released, 30);
        assert_eq!(reserve.metrics().unwrap().non_withdrawable_backing_yocto, 0);
        assert_eq!(reserve.metrics().unwrap().free_treasury_reserve_yocto, 0);
    }

    #[test]
    fn storage_shortfall_blocks_admission_and_record_release_until_topped_up() {
        let mut reserve = StorageReserveV1::empty(3);
        assert_eq!(
            reserve.register_record(bond(5, 2), 3),
            Err("storage reserve top-up required before admission")
        );
        assert_eq!(reserve.record_count, 0);
        reserve.top_up(1).unwrap();
        reserve.register_record(bond(5, 2), 3).unwrap();
        assert_eq!(reserve.metrics().unwrap().shortfall_yocto, 0);
        assert_eq!(reserve.release_payer_record(bond(5, 2), 3).unwrap(), 5);
    }

    #[test]
    fn closing_credit_row_moves_its_bond_to_treasury_once() {
        let mut reserve = StorageReserveV1::empty(2);
        reserve.register_record(bond(30, 10), 2).unwrap();
        reserve.close_credit_row(bond(30, 10), 2).unwrap();
        assert_eq!(reserve.record_count, 0);
        assert_eq!(reserve.treasury_capital_yocto, 30);
        assert_eq!(
            reserve.metrics().unwrap().non_withdrawable_backing_yocto,
            30
        );
        assert!(reserve.close_credit_row(bond(30, 10), 2).is_err());
    }

    #[test]
    fn byte_cost_revaluation_is_ordered_bounded_and_restarts_on_price_change() {
        let mut reserve = StorageReserveV1::empty(1);
        reserve.register_record(bond(10, 4), 1).unwrap();
        reserve.top_up(2).unwrap();
        reserve.register_record(bond(10, 12), 1).unwrap();
        reserve.begin_revaluation(2).unwrap();
        assert!(!reserve.is_ready(2));
        assert_eq!(
            reserve.revalue_batch(2, 0, &[bond(10, 4)]).unwrap(),
            RevaluationBatchResult::InProgress {
                next_record_index: 1
            }
        );
        assert_eq!(
            reserve.revalue_batch(2, 1, &[bond(10, 12)]).unwrap(),
            RevaluationBatchResult::Complete
        );
        assert!(!reserve.is_ready(2));
        assert_eq!(reserve.total_bond_excess_yocto, 2);
        assert_eq!(reserve.total_storage_gap_yocto, 14);
        assert_eq!(reserve.metrics().unwrap().shortfall_yocto, 12);

        reserve.top_up(12).unwrap();
        reserve.begin_revaluation(3).unwrap();
        assert_eq!(
            reserve.revalue_batch(4, 0, &[bond(10, 4)]).unwrap(),
            RevaluationBatchResult::RestartRequired
        );
        assert!(!reserve.is_ready(4));
        assert_eq!(
            reserve
                .revalue_batch(4, 0, &[bond(10, 4), bond(10, 12)])
                .unwrap(),
            RevaluationBatchResult::Complete
        );
        assert!(!reserve.is_ready(4));
        assert_eq!(reserve.storage_byte_cost_yocto, 4);
        assert_eq!(reserve.metrics().unwrap().shortfall_yocto, 30);
    }

    #[test]
    fn storage_reserve_rejects_overflow_stale_prices_and_oversized_batches() {
        let mut reserve = StorageReserveV1::empty(1);
        assert!(reserve.register_record(bond(1, 1), 2).is_err());
        assert!(reserve.register_record(bond(u128::MAX, 1), 1).is_ok());
        assert!(reserve.register_record(bond(u128::MAX, 1), 1).is_err());
        reserve.begin_revaluation(2).unwrap();
        let oversized = vec![bond(1, 1); MAX_REVALUATION_BATCH + 1];
        assert!(reserve.revalue_batch(2, 0, &oversized).is_err());
        assert!(reserve.revalue_batch(2, 1, &[bond(1, 1)]).is_err());

        reserve.revaluation = None;
        reserve.total_bond_excess_yocto = u128::MAX;
        reserve.treasury_capital_yocto = 1;
        assert_eq!(reserve.metrics(), Err("storage reserve backing overflow"));
        assert!(!reserve.is_ready(1));
    }

    #[test]
    fn persistent_registry_measures_releases_and_compacts_exact_storage_records() {
        initialize_storage_state();
        let first_id = [1; 32];
        let second_id = [2; 32];
        let first_key = b"fixture:tracked-record:first";
        let second_key = b"fixture:tracked-record:second";

        let first_credit_id = [11; 32];
        let second_credit_id = [12; 32];
        preallocate_refund_credit(
            first_credit_id,
            accounts(0),
            10_u128.pow(26),
            0,
            env::storage_usage(),
        );
        let first_before = env::storage_usage();
        env::storage_write(first_key, &[7; 80]);
        let first_bond = register_payer_measured_record(
            first_id,
            first_credit_id,
            10_u128.pow(26),
            first_before,
        );
        seal_refund_credit(first_credit_id);
        assert_eq!(
            first_bond.storage_bytes,
            env::storage_usage() - first_before
        );

        preallocate_refund_credit(
            second_credit_id,
            accounts(1),
            10_u128.pow(26),
            0,
            env::storage_usage(),
        );
        let second_before = env::storage_usage();
        env::storage_write(second_key, &[9; 96]);
        register_payer_measured_record(second_id, second_credit_id, 10_u128.pow(26), second_before);
        seal_refund_credit(second_credit_id);
        assert_eq!(load_reserve().record_count, 4);
        assert_eq!(read_bond_index(1), Some(first_id));
        assert_eq!(read_bond_index(3), Some(second_id));

        let first_remove_usage = env::storage_usage();
        env::storage_remove(first_key);
        let released = remove_measured_record(
            first_id,
            first_remove_usage,
            StorageBondReleaseV1::PayerCredit,
        );
        assert_eq!(released, first_bond);
        assert_eq!(load_reserve().record_count, 3);
        assert_eq!(read_bond_index(1), Some(second_id));
        assert_eq!(read_bond_index(3), None);
        assert_eq!(
            read_persisted_refund_credit(&first_credit_id)
                .unwrap()
                .state,
            RefundCreditStateV1::Available
        );

        native_cash::assert_solvency();

        let second_remove_usage = env::storage_usage();
        env::storage_remove(second_key);
        remove_measured_record(
            second_id,
            second_remove_usage,
            StorageBondReleaseV1::PayerCredit,
        );
        assert_eq!(load_reserve().record_count, 2);
        assert!(read_bond_index(1).is_some());
        native_cash::assert_solvency();
    }

    #[test]
    fn persistent_revaluation_pauses_cash_until_all_records_are_repriced() {
        initialize_storage_state();
        let record_id = [3; 32];
        let before = env::storage_usage();
        env::storage_write(b"fixture:revalue-record", &[5; 64]);
        let original_bond = 10_u128.pow(26);
        register_measured_record(record_id, original_bond, before);

        let mut reserve = load_reserve();
        reserve.storage_byte_cost_yocto = 1;
        save_reserve(&reserve);
        begin_storage_revaluation();
        assert!(reserve_readiness_fails());

        assert_eq!(
            revalue_storage_batch(0, 64),
            RevaluationBatchResult::Complete
        );
        assert_cash_gate_ready();
        assert_eq!(
            load_reserve().storage_byte_cost_yocto,
            env::storage_byte_cost().as_yoctonear()
        );
        native_cash::assert_solvency();
    }

    #[test]
    #[should_panic(expected = "recovery storage reserve is not ready")]
    fn native_cash_gate_rejects_an_active_storage_revaluation() {
        initialize_storage_state();
        let before = env::storage_usage();
        env::storage_write(b"fixture:stale-reserve-record", &[6; 64]);
        register_measured_record([5; 32], 10_u128.pow(26), before);

        let mut reserve = load_reserve();
        reserve.storage_byte_cost_yocto = 1;
        save_reserve(&reserve);
        assert!(begin_storage_revaluation());
        native_cash::assert_solvency();
    }

    #[test]
    fn successful_credit_row_close_reclassifies_its_bond_and_releases_q() {
        initialize_storage_state();
        let credit_id = [4; 32];
        let paid_yocto = 5_000;
        let original_bond_yocto = 10_u128.pow(26);

        let before = env::storage_usage();
        preallocate_refund_credit(
            credit_id,
            accounts(0),
            original_bond_yocto,
            paid_yocto,
            before,
        );
        let credit = read_persisted_refund_credit(&credit_id).unwrap();

        let before_remove = env::storage_usage();
        env::storage_remove(&refund_credit_key(&credit_id));
        remove_measured_record(
            credit.storage_bond_record_id,
            before_remove,
            StorageBondReleaseV1::CreditRowClosed {
                credit_id,
                paid_yocto,
            },
        );

        let reserve = load_reserve();
        assert_eq!(reserve.record_count, 0);
        assert_eq!(reserve.treasury_capital_yocto, original_bond_yocto);
        assert_eq!(native_cash::load().recovery_credit_liability, 0);
        native_cash::assert_solvency();
    }

    fn reserve_readiness_fails() -> bool {
        let reserve = load_reserve();
        !reserve.is_ready(env::storage_byte_cost().as_yoctonear())
    }

    #[test]
    fn no_redirection_recovery_credit_withdrawal_is_bound_to_recorded_payer() {
        let payer = accounts(0);
        let other = accounts(1);
        let mut credit = RefundCreditV1::preallocate(payer.clone(), 7);
        credit.register_live_bond_record().unwrap();
        credit.seal().unwrap();
        credit.release_record_bond(13).unwrap();
        let before = credit.clone();

        assert_eq!(
            credit.begin_withdrawal(&other),
            Err("only the refund payer may withdraw this credit")
        );
        assert_eq!(credit, before);

        let attempt = credit.begin_withdrawal(&payer).unwrap();
        assert_eq!(attempt.amount_yocto, 13);
        assert_eq!(
            credit
                .resolve_withdrawal(&other, attempt.amount_yocto, attempt.nonce, false)
                .unwrap(),
            None
        );
        assert!(matches!(&credit.state, RefundCreditStateV1::Withdrawing));
        assert_eq!(credit.accrued_yocto, 13);
        assert_eq!(credit.attempt_amount_yocto, 13);
        assert_eq!(credit.attempt_nonce, attempt.nonce);
    }

    #[test]
    fn no_duplicate_restoration_recovery_credit_failed_callback_restores_once() {
        let payer = accounts(0);
        let mut credit = RefundCreditV1::preallocate(payer.clone(), 7);
        credit.register_live_bond_record().unwrap();
        credit.seal().unwrap();
        credit.release_record_bond(13).unwrap();

        let attempt = credit.begin_withdrawal(&payer).unwrap();
        assert_eq!(attempt.amount_yocto, 13);
        assert_eq!(
            credit
                .resolve_withdrawal(&payer, attempt.amount_yocto, attempt.nonce, false)
                .unwrap(),
            None
        );
        assert!(matches!(&credit.state, RefundCreditStateV1::RefundPending));
        assert_eq!(credit.accrued_yocto, 13);

        // A stale duplicate failure while not withdrawing must be ignored and
        // must not restore the liability a second time.
        let after_failure = credit.clone();
        assert_eq!(
            credit
                .resolve_withdrawal(&payer, attempt.amount_yocto, attempt.nonce, false)
                .unwrap(),
            None
        );
        assert_eq!(credit, after_failure);

        let retry = credit.begin_withdrawal(&payer).unwrap();
        assert_eq!(retry.nonce, 2);
        assert_eq!(
            credit
                .resolve_withdrawal(&payer, attempt.amount_yocto, attempt.nonce, false)
                .unwrap(),
            None
        );
        assert!(matches!(&credit.state, RefundCreditStateV1::Withdrawing));
        assert_eq!(credit.accrued_yocto, 13);
        assert_eq!(credit.next_withdrawal_nonce, 2);
    }

    #[test]
    fn no_double_payment_recovery_credit_cannot_be_paid_twice() {
        let payer = accounts(0);
        let mut credit = RefundCreditV1::preallocate(payer.clone(), 7);
        credit.register_live_bond_record().unwrap();
        credit.seal().unwrap();
        credit.release_record_bond(13).unwrap();

        let attempt = credit.begin_withdrawal(&payer).unwrap();
        let closed = credit
            .resolve_withdrawal(&payer, attempt.amount_yocto, attempt.nonce, true)
            .unwrap()
            .unwrap();
        assert_eq!(closed.paid_yocto, 13);
        assert_eq!(closed.treasury_bond_yocto, 7);
        assert_eq!(credit.accrued_yocto, 0);
        assert!(credit.settled);

        assert_eq!(
            credit.begin_withdrawal(&payer),
            Err("refund credit has already been paid")
        );
        assert_eq!(
            credit
                .resolve_withdrawal(&payer, attempt.amount_yocto, attempt.nonce, true)
                .unwrap(),
            None
        );
        assert_eq!(credit.accrued_yocto, 0);
        assert!(credit.settled);
    }
}
