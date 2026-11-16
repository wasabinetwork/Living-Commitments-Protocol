    fn audit_conservation(c: &Contract, id: U64) {
        let v=c.get_escrow_status(id).unwrap();
        assert_eq!(v.funded_raw.0,v.paid_raw.0+v.refunded_raw.0+v.pending_raw.0+v.free_raw.0);
        assert!(v.funded_raw.0<=4_500_000);
        assert_eq!(v.funded_yocto.0,0);
    }
    #[test]
    fn audit_partial_funding_sequence() {
        let (mut c,id)=create_usdc_service_commitment();
        let token:AccountId=NEAR_TESTNET_USDC_ACCOUNT.parse().unwrap();
        let msg=near_sdk::serde_json::to_string(&json!({"schema":"lcp.funding.v1","commitment_id":id})).unwrap();
        let mut accepted=0;
        for value in [0,1,999_999,2_000_000,u128::MAX,7] {
            testing_env!(context(token.clone(),0));
            let PromiseOrValue::Value(unused)=c.ft_on_transfer(accounts(1),U128(value),msg.clone()) else {panic!()};
            accepted+=value-unused.0;
            assert_eq!(c.get_escrow_status(id).unwrap().funded_raw.0,accepted);
            audit_conservation(&c,id);
        }
        assert_eq!(accepted,4_500_000);
    }
    #[test]
    fn audit_invalid_messages_return_entire_amount() {
        let(mut c,id)=create_usdc_service_commitment();
        for msg in ["null","{}","broken","{\"schema\":\"lcp.funding.v1\",\"commitment_id\":\"999\"}"] {
            testing_env!(context(NEAR_TESTNET_USDC_ACCOUNT.parse().unwrap(),0));
            assert!(matches!(c.ft_on_transfer(accounts(1),U128(42),msg.into()),PromiseOrValue::Value(U128(42))));
            audit_conservation(&c,id);
        }
    }
    #[test]
    #[allow(deprecated)]
    fn audit_callback_permutations_and_old_id() {
        let(mut c,id)=create_usdc_service_commitment();fund_and_activate_usdc_service_commitment(&mut c,id);
        for success in [false,false,true] {
            testing_env!(context_at(accounts(3),10_u128.pow(25),NOW_NS));
            let transfer=c.claim_tranche(id);audit_conservation(&c,id);
            testing_env_with_promise_results(context(accounts(0),0),PromiseResult::Successful(vec![]));
            c.on_refund_transfer(transfer);c.on_tranche_transfer(U64(999999));audit_conservation(&c,id);
            assert_eq!(c.get_escrow_status(id).unwrap().pending_raw.0,1_500_000);
            testing_env_with_promise_results(context(accounts(0),0),if success {PromiseResult::Successful(vec![])}else{PromiseResult::Failed});
            c.on_tranche_transfer(transfer);c.on_tranche_transfer(transfer);audit_conservation(&c,id);
        }
        assert_eq!(c.get_escrow_status(id).unwrap().paid_raw.0,1_500_000);
    }
    #[test]
    #[should_panic(expected="NEP-141 escrow must be funded")]
    fn audit_near_cannot_fund_token(){let(mut c,id)=create_usdc_service_commitment();testing_env!(context(accounts(1),100));c.fund_commitment(id);}
    #[test]
    #[should_panic(expected="native NEAR commitments only")]
    fn audit_adapter_rejects_token(){let(mut c,id)=create_usdc_service_commitment();testing_env!(context(accounts(1),0));c.create_bounded_payout_authority_grant(id,"a".repeat(64),accounts(4),accounts(5),U128(1),U128(2),U64(NOW_NS+100));}
    #[test]
    #[should_panic(expected="required escrow calculation overflow")]
    fn audit_u128_cap_overflow(){testing_env!(context(accounts(1),0));let mut a=usdc_service_commitment_args().policy.budget;a.tranche_amount_raw=Some(U128(u128::MAX));build_budget_policy(a,"testnet");}
    #[test]
    #[should_panic(expected="current NEAR network")]
    fn audit_wrong_network_token(){testing_env!(context(accounts(1),0));build_budget_policy(usdc_service_commitment_args().policy.budget,"mainnet");}
    #[test]
    fn audit_single_atomic_tranche(){testing_env!(context(accounts(1),0));let mut a=usdc_service_commitment_args().policy.budget;a.tranche_amount_raw=Some(U128(1));let (budget,state)=build_budget_policy(a,"testnet");assert_eq!(budget.tranche_yocto,0);assert_eq!(state.unwrap().tranche_amount_raw,1);}
    #[test]
    #[allow(deprecated)]
    fn audit_missing_transfer_sidecar_stays_reserved(){let(mut c,id)=create_usdc_service_commitment();fund_and_activate_usdc_service_commitment(&mut c,id);testing_env!(context_at(accounts(3),10_u128.pow(25),NOW_NS));let transfer=c.claim_tranche(id);remove_settlement_transfer_amount(transfer.0);testing_env_with_promise_results(context(accounts(0),0),PromiseResult::Successful(vec![]));c.on_tranche_transfer(transfer);assert_eq!(c.get_escrow_status(id).unwrap().pending_raw.0,1_500_000);assert!(c.pending_transfers.get(&transfer.0).is_some());}
