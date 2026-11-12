#![forbid(unsafe_code)]

use near_sdk::{
    env,
    json_types::{U128, U64},
    near, require,
    serde::Serialize,
    AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

const TRANSFER_CALLBACK_GAS_TGAS: u64 = 10;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    lcp_contract_id: AccountId,
    pool_manager: AccountId,
    resource_account: AccountId,
    pool_available_yocto: u128,
    pending_amount_yocto: u128,
    pending_action_nonce: u64,
    pending_is_withdrawal: bool,
    last_withdrawal_nonce: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PoolStatusView {
    pub lcp_contract_id: AccountId,
    pub pool_manager: AccountId,
    pub resource_account: AccountId,
    pub available_yocto: U128,
    pub pending_yocto: U128,
    pub pending_action_nonce: Option<U64>,
    pub pending_kind: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{accounts, VMContextBuilder},
        testing_env, AccountId, NearToken, PromiseResult,
    };

    fn context(predecessor: AccountId, attached_deposit: u128) -> near_sdk::VMContext {
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(predecessor)
            .attached_deposit(NearToken::from_yoctonear(attached_deposit))
            .build()
    }

    fn adapter() -> Contract {
        testing_env!(context(accounts(0), 0));
        Contract::new(accounts(1), accounts(3), accounts(2))
    }

    #[allow(deprecated)]
    fn set_promise_result(context: near_sdk::VMContext, result: PromiseResult) {
        near_sdk::test_utils::testing_env_with_promise_results(context, result);
    }

    #[test]
    fn failed_manager_withdrawal_restores_available_pool() {
        let mut adapter = adapter();
        testing_env!(context(accounts(4), 100));
        adapter.fund_pool();

        testing_env!(context(accounts(2), 0));
        let _ = adapter.withdraw_pool(accounts(2), U128(40));
        let pending = adapter.get_pool_status();
        assert_eq!(pending.available_yocto, U128(60));
        assert_eq!(pending.pending_yocto, U128(40));
        assert_eq!(pending.pending_kind.as_deref(), Some("manager_withdrawal"));

        set_promise_result(context(accounts(0), 0), PromiseResult::Failed);
        assert!(!adapter.on_pool_withdrawal_settled(U64(1)));
        let settled = adapter.get_pool_status();
        assert_eq!(settled.available_yocto, U128(100));
        assert_eq!(settled.pending_yocto, U128(0));
        assert_eq!(settled.pending_kind, None);
    }

    #[test]
    fn successful_manager_withdrawal_removes_only_requested_amount() {
        let mut adapter = adapter();
        testing_env!(context(accounts(4), 100));
        adapter.fund_pool();

        testing_env!(context(accounts(2), 0));
        let _ = adapter.withdraw_pool(accounts(2), U128(35));
        set_promise_result(
            context(accounts(0), 0),
            PromiseResult::Successful(Vec::new()),
        );
        assert!(adapter.on_pool_withdrawal_settled(U64(1)));
        assert_eq!(adapter.get_pool_status().available_yocto, U128(65));
    }

    #[test]
    fn failed_authorized_payout_restores_pool_and_identifies_pending_kind() {
        let mut adapter = adapter();
        testing_env!(context(accounts(4), 100));
        adapter.fund_pool();

        testing_env!(context(accounts(1), 0));
        let _ = adapter.execute_authorized_action(accounts(2), U64(7), accounts(3), U128(40));
        let pending = adapter.get_pool_status();
        assert_eq!(pending.available_yocto, U128(60));
        assert_eq!(pending.pending_kind.as_deref(), Some("authorized_payout"));

        set_promise_result(context(accounts(0), 0), PromiseResult::Failed);
        assert!(!adapter.on_payout_settled(U64(7)));
        assert_eq!(adapter.get_pool_status().available_yocto, U128(100));
    }

    #[test]
    #[should_panic(expected = "only the pool manager can withdraw adapter funds")]
    fn only_configured_pool_manager_can_withdraw() {
        let mut adapter = adapter();
        testing_env!(context(accounts(4), 10));
        adapter.fund_pool();
        testing_env!(context(accounts(5), 0));
        let _ = adapter.withdraw_pool(accounts(5), U128(1));
    }

    #[test]
    #[should_panic(expected = "adapter pool has insufficient available funds")]
    fn manager_cannot_withdraw_more_than_available_pool() {
        let mut adapter = adapter();
        testing_env!(context(accounts(2), 10));
        adapter.fund_pool();
        let _ = adapter.withdraw_pool(accounts(2), U128(11));
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        lcp_contract_id: AccountId,
        resource_account: AccountId,
        pool_manager: AccountId,
    ) -> Self {
        require!(
            lcp_contract_id != env::current_account_id(),
            "adapter cannot authorize itself"
        );
        Self {
            lcp_contract_id,
            pool_manager,
            resource_account,
            pool_available_yocto: 0,
            pending_amount_yocto: 0,
            pending_action_nonce: 0,
            pending_is_withdrawal: false,
            last_withdrawal_nonce: 0,
        }
    }

    #[payable]
    pub fn fund_pool(&mut self) -> U128 {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a positive pool deposit");
        self.pool_available_yocto = self
            .pool_available_yocto
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("adapter pool balance overflow"));
        U128(self.pool_available_yocto)
    }

    pub fn execute_authorized_action(
        &mut self,
        granting_account: AccountId,
        action_nonce: U64,
        resource_account: AccountId,
        amount_yocto: U128,
    ) -> Promise {
        require!(
            env::predecessor_account_id() == self.lcp_contract_id,
            "only the configured LCP contract can authorize a payout"
        );
        require!(
            granting_account == self.pool_manager,
            "only the configured pool manager can authorize a payout"
        );
        require!(
            resource_account == self.resource_account,
            "payout resource does not match this adapter instance"
        );
        require!(
            self.pending_amount_yocto == 0,
            "another adapter payout is still settling"
        );
        require!(amount_yocto.0 > 0, "authorized payout must be positive");
        require!(
            amount_yocto.0 <= self.pool_available_yocto,
            "adapter pool has insufficient available funds"
        );

        self.pool_available_yocto -= amount_yocto.0;
        self.pending_amount_yocto = amount_yocto.0;
        self.pending_action_nonce = action_nonce.0;
        self.pending_is_withdrawal = false;
        let callback_args = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
            "action_nonce": action_nonce,
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize adapter payout callback"));
        Promise::new(self.resource_account.clone())
            .transfer(NearToken::from_yoctonear(amount_yocto.0))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_payout_settled".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(TRANSFER_CALLBACK_GAS_TGAS),
            ))
    }

    /// Withdraws only funds explicitly tracked in this adapter's available pool.
    /// The configured pool manager can withdraw available funds; failed transfers
    /// are reconciled back into the pool by the private callback.
    pub fn withdraw_pool(&mut self, recipient: AccountId, amount_yocto: U128) -> Promise {
        require!(
            env::predecessor_account_id() == self.pool_manager,
            "only the pool manager can withdraw adapter funds"
        );
        require!(
            recipient != env::current_account_id(),
            "withdrawal recipient must differ from the adapter account"
        );
        require!(
            self.pending_amount_yocto == 0,
            "another adapter transfer is still settling"
        );
        require!(amount_yocto.0 > 0, "withdrawal amount must be positive");
        require!(
            amount_yocto.0 <= self.pool_available_yocto,
            "adapter pool has insufficient available funds"
        );

        let withdrawal_nonce = self
            .last_withdrawal_nonce
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("adapter withdrawal nonce overflow"));
        self.last_withdrawal_nonce = withdrawal_nonce;
        self.pool_available_yocto -= amount_yocto.0;
        self.pending_amount_yocto = amount_yocto.0;
        self.pending_action_nonce = withdrawal_nonce;
        self.pending_is_withdrawal = true;
        let callback_args = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
            "withdrawal_nonce": U64(withdrawal_nonce),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize adapter withdrawal callback"));
        Promise::new(recipient)
            .transfer(NearToken::from_yoctonear(amount_yocto.0))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_pool_withdrawal_settled".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(TRANSFER_CALLBACK_GAS_TGAS),
            ))
    }

    #[private]
    pub fn on_payout_settled(&mut self, action_nonce: U64) -> bool {
        require!(
            self.pending_amount_yocto > 0,
            "no adapter payout is pending"
        );
        require!(
            !self.pending_is_withdrawal,
            "pending transfer is a manager withdrawal"
        );
        require!(
            self.pending_action_nonce == action_nonce.0,
            "payout callback does not match the pending action"
        );
        require!(
            env::promise_results_count() == 1,
            "adapter payout callback requires one transfer result"
        );
        let settled = env::promise_result_checked(0, 0).is_ok();
        if !settled {
            self.pool_available_yocto = self
                .pool_available_yocto
                .checked_add(self.pending_amount_yocto)
                .unwrap_or_else(|| env::panic_str("adapter pool reconciliation overflow"));
        }
        self.pending_amount_yocto = 0;
        self.pending_action_nonce = 0;
        self.pending_is_withdrawal = false;
        settled
    }

    #[private]
    pub fn on_pool_withdrawal_settled(&mut self, withdrawal_nonce: U64) -> bool {
        require!(
            self.pending_amount_yocto > 0,
            "no adapter withdrawal is pending"
        );
        require!(
            self.pending_is_withdrawal,
            "pending transfer is not a manager withdrawal"
        );
        require!(
            self.pending_action_nonce == withdrawal_nonce.0,
            "withdrawal callback does not match the pending transfer"
        );
        require!(
            env::promise_results_count() == 1,
            "adapter withdrawal callback requires one transfer result"
        );
        let settled = env::promise_result_checked(0, 0).is_ok();
        if !settled {
            self.pool_available_yocto = self
                .pool_available_yocto
                .checked_add(self.pending_amount_yocto)
                .unwrap_or_else(|| env::panic_str("adapter pool reconciliation overflow"));
        }
        self.pending_amount_yocto = 0;
        self.pending_action_nonce = 0;
        self.pending_is_withdrawal = false;
        settled
    }

    pub fn get_pool_status(&self) -> PoolStatusView {
        PoolStatusView {
            lcp_contract_id: self.lcp_contract_id.clone(),
            pool_manager: self.pool_manager.clone(),
            resource_account: self.resource_account.clone(),
            available_yocto: U128(self.pool_available_yocto),
            pending_yocto: U128(self.pending_amount_yocto),
            pending_action_nonce: (self.pending_amount_yocto > 0)
                .then_some(U64(self.pending_action_nonce)),
            pending_kind: (self.pending_amount_yocto > 0).then(|| {
                if self.pending_is_withdrawal {
                    "manager_withdrawal".to_string()
                } else {
                    "authorized_payout".to_string()
                }
            }),
        }
    }
}
