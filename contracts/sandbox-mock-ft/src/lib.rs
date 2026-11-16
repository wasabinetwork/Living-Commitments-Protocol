use near_sdk::{env, json_types::U128, near, require, store::LookupMap, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    balances: LookupMap<AccountId, u128>,
    fail_transfers: bool,
    fail_after_mutation: bool,
}

#[near]
impl MockFt {
    #[init]
    pub fn new(initial_holder: AccountId, initial_balance: U128) -> Self {
        let mut balances = LookupMap::new(b"mock-ft-balances".to_vec());
        balances.insert(initial_holder, initial_balance.0);
        Self {
            balances,
            fail_transfers: false,
            fail_after_mutation: false,
        }
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or_default())
    }

    pub fn ft_contract_version(&self) -> u8 {
        if cfg!(feature = "variant-b") {
            2
        } else {
            1
        }
    }

    pub fn set_fail_transfers(&mut self, fail: bool) {
        self.fail_transfers = fail;
    }

    pub fn set_fail_after_mutation(&mut self, fail: bool) {
        self.fail_after_mutation = fail;
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, _memo: Option<String>) {
        require!(
            env::attached_deposit().as_yoctonear() == 1,
            "ft_transfer requires one yoctoNEAR"
        );
        require!(
            !self.fail_transfers,
            "mock token transfer failure requested"
        );
        let sender_id = env::predecessor_account_id();
        let sender_balance = self.balances.get(&sender_id).copied().unwrap_or_default();
        require!(
            sender_balance >= amount.0,
            "mock token balance is insufficient"
        );
        self.balances.insert(sender_id, sender_balance - amount.0);
        let receiver_balance = self.balances.get(&receiver_id).copied().unwrap_or_default();
        self.balances.insert(
            receiver_id,
            receiver_balance
                .checked_add(amount.0)
                .unwrap_or_else(|| env::panic_str("mock token balance overflow")),
        );
        if self.fail_after_mutation {
            env::panic_str("mock token failure after balance writes");
        }
    }
}
