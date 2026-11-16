    #[test]
    fn recovery_review_zero_results_callback_releases_pending() {
        let(mut c,id)=create_usdc_service_commitment();
        fund_and_activate_usdc_service_commitment(&mut c,id);
        testing_env!(context_at(accounts(3),10_u128.pow(25),NOW_NS));
        let transfer=c.claim_tranche(id);
        assert_eq!(c.get_escrow_status(id).unwrap().pending_raw.0,1_500_000);
        // Direct unit invocation intentionally bypasses generated private wrapper.
        // It models a future recovery entry point incorrectly reusing the callback.
        testing_env!(context_at(accounts(0),0,NOW_NS));
        assert_eq!(env::promise_results_count(),0);
        c.on_tranche_transfer(transfer);
        let v=c.get_escrow_status(id).unwrap();
        assert_eq!(v.pending_raw.0,0);assert_eq!(v.paid_raw.0,0);assert_eq!(v.free_raw.0,4_500_000);
    }
    #[test]
    #[allow(deprecated)]
    fn recovery_review_missing_entire_settlement_sidecar_consumes_token_id_as_near() {
        let(mut c,id)=create_usdc_service_commitment();fund_and_activate_usdc_service_commitment(&mut c,id);
        testing_env!(context_at(accounts(3),10_u128.pow(25),NOW_NS));
        let transfer=c.claim_tranche(id);
        env::storage_remove(&settlement_state_storage_key(id.0));
        testing_env_with_promise_results(context(accounts(0),0),PromiseResult::Successful(vec![]));
        c.on_tranche_transfer(transfer);
        assert!(c.pending_transfers.get(&transfer.0).is_none());
        assert_eq!(c.get_tranche(id,U64(0)).unwrap().status,TrancheStatus::Paid);
        assert_eq!(c.commitments.get(&id.0).unwrap().escrow_paid_yocto,0);
        assert!(read_settlement_transfer_amount(transfer.0).is_some());
    }
    #[test]
    #[allow(deprecated)]
    fn recovery_review_conflicting_late_callback_cannot_settle_retry() {
        let(mut c,id)=create_usdc_service_commitment();fund_and_activate_usdc_service_commitment(&mut c,id);
        testing_env!(context_at(accounts(3),10_u128.pow(25),NOW_NS));let old=c.claim_tranche(id);
        testing_env_with_promise_results(context(accounts(0),0),PromiseResult::Failed);c.on_tranche_transfer(old);
        testing_env!(context_at(accounts(3),10_u128.pow(25),NOW_NS));let retry=c.claim_tranche(id);
        testing_env_with_promise_results(context(accounts(0),0),PromiseResult::Successful(vec![]));
        c.on_tranche_transfer(old);assert_eq!(c.get_escrow_status(id).unwrap().pending_raw.0,1_500_000);
        c.on_tranche_transfer(retry);c.on_tranche_transfer(retry);
        let v=c.get_escrow_status(id).unwrap();assert_eq!(v.paid_raw.0,1_500_000);assert_eq!(v.pending_raw.0,0);
        assert_eq!(v.funded_raw.0,v.paid_raw.0+v.free_raw.0+v.refunded_raw.0+v.pending_raw.0);
    }
