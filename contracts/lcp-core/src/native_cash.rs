//! Versioned native-cash accounting sidecar for the recovery-enabled core.
//!
//! This module deliberately contains no migration fallback. `initialize_fresh`
//! is called only by `Contract::new`; an existing deployment without this key
//! cannot silently start with a zeroed liability ledger.
//!
//! The existing native escrow, operations, and legacy refund flows use this
//! ledger. The fresh-instance storage reserve is checked before every cash
//! gate; payer recovery-credit primitives are integrated with the feature-
//! gated NEP-141 recovery flow. NEAR VM acceptance remains open.
//! The SDK `Promise` is a lazy builder: its host actions are materialized when
//! the builder is dropped. The pinned nearcore host deducts attached transfer
//! and function-call value when those actions are materialized. Callers record
//! the complete planned receipt outflow in `scheduled_outflow_yocto` and run
//! the cash check before the first relevant builder is dropped.
#![allow(dead_code)]

use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    env, AccountId,
};

const STORAGE_KEY: &[u8] = b"lcp:native-cash-ledger:v1";
const REFUND_ATTEMPT_PREFIX: &[u8] = b"lcp:native-cash-refund-attempt:v1:";
const VERSION: u8 = 1;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct NativeCashLedgerV1 {
    version: u8,
    pub(crate) next_attempt_id: u64,
    /// Unpaid native escrow, including payouts/refunds with unresolved callbacks.
    pub(crate) native_escrow_liability: u128,
    /// Unspent evaluator operations, including an unresolved operations refund.
    pub(crate) operations_liability: u128,
    /// Available and in-flight legacy storage-refund credits, including excess deposits.
    pub(crate) storage_refund_liability: u128,
    /// Recovery-credit amounts accrued but not proven paid.
    pub(crate) recovery_credit_liability: u128,
    /// Non-withdrawable storage-bond excess and free recovery reserve.
    pub(crate) storage_backing: u128,
    /// Storage-price deficit. Any nonzero value pauses solvency-sensitive actions.
    pub(crate) storage_shortfall: u128,
    /// Native value scheduled by promises in the current receipt. Cleared only
    /// after the end-of-method solvency check passes.
    pub(crate) scheduled_outflow_yocto: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeLiability {
    Escrow,
    Operations,
    StorageRefund,
    RecoveryCredit,
    StorageBacking,
    StorageShortfall,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) enum RefundAttemptKind {
    Excess,
    CreditWithdrawal,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct RefundAttemptV1 {
    pub(crate) id: u64,
    pub(crate) payer: AccountId,
    pub(crate) amount: u128,
    pub(crate) kind: RefundAttemptKind,
}

impl NativeCashLedgerV1 {
    pub(crate) fn empty() -> Self {
        Self {
            version: VERSION,
            next_attempt_id: 0,
            native_escrow_liability: 0,
            operations_liability: 0,
            storage_refund_liability: 0,
            recovery_credit_liability: 0,
            storage_backing: 0,
            storage_shortfall: 0,
            scheduled_outflow_yocto: 0,
        }
    }

    pub(crate) fn adjust(
        &mut self,
        liability: NativeLiability,
        increase: bool,
        amount: u128,
    ) -> Result<(), &'static str> {
        let field = match liability {
            NativeLiability::Escrow => &mut self.native_escrow_liability,
            NativeLiability::Operations => &mut self.operations_liability,
            NativeLiability::StorageRefund => &mut self.storage_refund_liability,
            NativeLiability::RecoveryCredit => &mut self.recovery_credit_liability,
            NativeLiability::StorageBacking => &mut self.storage_backing,
            NativeLiability::StorageShortfall => &mut self.storage_shortfall,
        };
        *field = if increase {
            field
                .checked_add(amount)
                .ok_or("native cash ledger overflow")?
        } else {
            field
                .checked_sub(amount)
                .ok_or("native cash ledger underflow")?
        };
        Ok(())
    }

    pub(crate) fn allocate_attempt_id(&mut self) -> Result<u64, &'static str> {
        self.next_attempt_id = self
            .next_attempt_id
            .checked_add(1)
            .ok_or("native cash attempt ID overflow")?;
        Ok(self.next_attempt_id)
    }

    pub(crate) fn required_balance(&self, storage_cost: u128) -> Option<u128> {
        if self.version != VERSION || self.storage_shortfall != 0 {
            return None;
        }
        [
            storage_cost,
            self.native_escrow_liability,
            self.operations_liability,
            self.storage_refund_liability,
            self.recovery_credit_liability,
            self.storage_backing,
            self.scheduled_outflow_yocto,
        ]
        .into_iter()
        .try_fold(0_u128, u128::checked_add)
    }

    pub(crate) fn is_solvent(&self, account_balance: u128, storage_cost: u128) -> bool {
        self.required_balance(storage_cost)
            .is_some_and(|required| account_balance >= required)
    }
}

pub(crate) fn initialize_fresh() {
    if env::storage_read(STORAGE_KEY).is_some() {
        env::panic_str("native cash ledger already initialized");
    }
    write(&NativeCashLedgerV1::empty());
}

#[cfg(test)]
pub(crate) fn clear_initializer_for_test() {
    env::storage_remove(STORAGE_KEY);
}

pub(crate) fn load() -> NativeCashLedgerV1 {
    let bytes = env::storage_read(STORAGE_KEY).unwrap_or_else(|| {
        env::panic_str("native cash ledger is not initialized for this instance")
    });
    let ledger: NativeCashLedgerV1 = near_sdk::borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("native cash ledger is malformed"));
    if ledger.version != VERSION {
        env::panic_str("native cash ledger version is unsupported");
    }
    ledger
}

pub(crate) fn save(ledger: &NativeCashLedgerV1) {
    write(ledger);
}

pub(crate) fn adjust(liability: NativeLiability, increase: bool, amount: u128) {
    let mut ledger = load();
    ledger
        .adjust(liability, increase, amount)
        .unwrap_or_else(|message| env::panic_str(message));
    save(&ledger);
}

/// Records an outgoing native transfer or function-call deposit in the current
/// receipt. The cash check runs before SDK `Promise` builders materialize host
/// actions, so include the complete planned outflow here. Host materialization
/// deducts attached value from `env::account_balance()`.
pub(crate) fn record_outflow(amount: u128) {
    if amount == 0 {
        return;
    }
    let mut ledger = load();
    ledger.scheduled_outflow_yocto = ledger
        .scheduled_outflow_yocto
        .checked_add(amount)
        .unwrap_or_else(|| env::panic_str("native cash scheduled outflow overflow"));
    save(&ledger);
}

/// Persists a refund attempt before its transfer promise is created. `new_liability`
/// is true for an excess deposit and false when moving an already-counted credit into flight.
pub(crate) fn begin_refund_attempt(
    payer: AccountId,
    amount: u128,
    kind: RefundAttemptKind,
    new_liability: bool,
) -> u64 {
    assert!(amount > 0, "native refund attempt amount must be positive");
    let mut ledger = load();
    let id = ledger
        .allocate_attempt_id()
        .unwrap_or_else(|message| env::panic_str(message));
    if new_liability {
        ledger
            .adjust(NativeLiability::StorageRefund, true, amount)
            .unwrap_or_else(|message| env::panic_str(message));
    }
    save(&ledger);

    let attempt = RefundAttemptV1 {
        id,
        payer,
        amount,
        kind,
    };
    let bytes = near_sdk::borsh::to_vec(&attempt)
        .unwrap_or_else(|_| env::panic_str("failed to serialize native refund attempt"));
    env::storage_write(&refund_attempt_storage_key(id), &bytes);
    id
}

pub(crate) fn read_refund_attempt(id: u64) -> Option<RefundAttemptV1> {
    let bytes = env::storage_read(&refund_attempt_storage_key(id))?;
    Some(
        near_sdk::borsh::from_slice(&bytes)
            .unwrap_or_else(|_| env::panic_str("native refund attempt is malformed")),
    )
}

/// Removes an explicitly failed attempt. The amount remains a payable storage-refund liability.
pub(crate) fn remove_failed_refund_attempt(id: u64) -> Option<RefundAttemptV1> {
    let attempt = read_refund_attempt(id)?;
    env::storage_remove(&refund_attempt_storage_key(id));
    Some(attempt)
}

/// Removes an explicitly successful attempt and releases its payable liability exactly once.
pub(crate) fn settle_successful_refund_attempt(id: u64) -> Option<RefundAttemptV1> {
    let attempt = read_refund_attempt(id)?;
    let mut ledger = load();
    ledger
        .adjust(NativeLiability::StorageRefund, false, attempt.amount)
        .unwrap_or_else(|message| env::panic_str(message));
    save(&ledger);
    env::storage_remove(&refund_attempt_storage_key(id));
    Some(attempt)
}

pub(crate) fn assert_solvency() {
    crate::recovery_accounting::assert_cash_gate_ready();
    let mut ledger = load();
    let storage_cost = env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(env::storage_usage()))
        .unwrap_or_else(|| env::panic_str("native cash storage cost overflow"));
    let account_balance = env::account_balance().as_yoctonear();
    if !ledger.is_solvent(account_balance, storage_cost) {
        #[cfg(feature = "sandbox-callback-fixture")]
        env::log_str(&format!(
            "SANDBOX_CASH_GATE_FAILED C={} S={} escrow={} operations={} legacy_refund={} recovery_credit={} F={} X={} storage_shortfall={}",
            account_balance,
            storage_cost,
            ledger.native_escrow_liability,
            ledger.operations_liability,
            ledger.storage_refund_liability,
            ledger.recovery_credit_liability,
            ledger.storage_backing,
            ledger.scheduled_outflow_yocto,
            ledger.storage_shortfall,
        ));
        env::panic_str("native cash solvency check failed");
    }
    ledger.scheduled_outflow_yocto = 0;
    save(&ledger);
}

/// Read-only balance check used by public views. Callers must separately
/// check that the versioned storage reserve is current and fully backed.
pub(crate) fn solvency_snapshot_ready() -> bool {
    solvency_snapshot_ready_with_outflow(0)
}

/// Checks the current ledger plus an additional prospective receipt outflow,
/// without mutating state. This lets views predict the margin required before
/// a whole-row refund-credit withdrawal is scheduled.
pub(crate) fn solvency_snapshot_ready_with_outflow(additional_outflow: u128) -> bool {
    let Some(bytes) = env::storage_read(STORAGE_KEY) else {
        return false;
    };
    let Ok(ledger) = near_sdk::borsh::from_slice::<NativeCashLedgerV1>(&bytes) else {
        return false;
    };
    if ledger.version != VERSION {
        return false;
    }
    let Some(storage_cost) = env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(env::storage_usage()))
    else {
        return false;
    };
    let Some(required) = ledger
        .required_balance(storage_cost)
        .and_then(|amount| amount.checked_add(additional_outflow))
    else {
        return false;
    };
    env::account_balance().as_yoctonear() >= required
}

fn write(ledger: &NativeCashLedgerV1) {
    let bytes = near_sdk::borsh::to_vec(ledger)
        .unwrap_or_else(|_| env::panic_str("failed to serialize native cash ledger"));
    env::storage_write(STORAGE_KEY, &bytes);
}

fn refund_attempt_storage_key(id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(REFUND_ATTEMPT_PREFIX.len() + 8);
    key.extend_from_slice(REFUND_ATTEMPT_PREFIX);
    key.extend_from_slice(&id.to_le_bytes());
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{accounts, VMContextBuilder},
        testing_env, NearToken,
    };

    #[test]
    fn required_balance_covers_storage_all_liability_classes_and_backing() {
        let mut ledger = NativeCashLedgerV1::empty();
        ledger.adjust(NativeLiability::Escrow, true, 10).unwrap();
        ledger
            .adjust(NativeLiability::Operations, true, 20)
            .unwrap();
        ledger
            .adjust(NativeLiability::StorageRefund, true, 30)
            .unwrap();
        ledger
            .adjust(NativeLiability::RecoveryCredit, true, 40)
            .unwrap();
        ledger
            .adjust(NativeLiability::StorageBacking, true, 50)
            .unwrap();

        assert_eq!(ledger.required_balance(60), Some(210));
        assert!(!ledger.is_solvent(209, 60));
        assert!(ledger.is_solvent(210, 60));
    }

    #[test]
    fn required_balance_includes_scheduled_promise_outflows() {
        let mut ledger = NativeCashLedgerV1::empty();
        ledger.adjust(NativeLiability::Escrow, true, 10).unwrap();
        ledger.scheduled_outflow_yocto = 1;

        assert_eq!(ledger.required_balance(60), Some(71));
        assert!(!ledger.is_solvent(70, 60));
        assert!(ledger.is_solvent(71, 60));
    }

    #[test]
    fn storage_shortfall_fails_closed_even_when_balance_is_large() {
        let mut ledger = NativeCashLedgerV1::empty();
        ledger
            .adjust(NativeLiability::StorageShortfall, true, 1)
            .unwrap();

        assert_eq!(ledger.required_balance(0), None);
        assert!(!ledger.is_solvent(u128::MAX, 0));
    }

    #[test]
    fn liability_underflow_and_attempt_id_overflow_are_rejected() {
        let mut ledger = NativeCashLedgerV1::empty();
        assert_eq!(
            ledger.adjust(NativeLiability::Escrow, false, 1),
            Err("native cash ledger underflow")
        );
        ledger.next_attempt_id = u64::MAX;
        assert_eq!(
            ledger.allocate_attempt_id(),
            Err("native cash attempt ID overflow")
        );
    }

    #[test]
    #[should_panic(expected = "native cash solvency check failed")]
    fn solvency_gate_rejects_liabilities_without_backing_cash() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .account_balance(NearToken::from_yoctonear(0))
            .build());
        initialize_fresh();
        crate::recovery_accounting::initialize_fresh();
        adjust(NativeLiability::Escrow, true, 1);

        assert_solvency();
    }

    #[test]
    fn solvency_gate_accepts_fully_backed_native_liabilities() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .account_balance(NearToken::from_yoctonear(10_u128.pow(30)))
            .build());
        initialize_fresh();
        crate::recovery_accounting::initialize_fresh();
        adjust(NativeLiability::Escrow, true, 1);

        assert_solvency();
    }

    #[test]
    #[should_panic(expected = "native cash ledger already initialized")]
    fn fresh_native_cash_ledger_rejects_reinitialization() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .account_balance(NearToken::from_yoctonear(10_u128.pow(30)))
            .build());
        initialize_fresh();
        initialize_fresh();
    }
}
