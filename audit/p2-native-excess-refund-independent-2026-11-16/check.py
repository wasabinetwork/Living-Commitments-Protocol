import json,pathlib,sys
p=pathlib.Path(sys.argv[1]); d=json.loads(p.read_text()); s=d['scenarios']['native_excess_refund_cash_gate']; out={'node':d['node'],'artifacts':d['wasm_artifacts'],'transactions':{k:v for k,v in s.items() if k.endswith('transaction_hash')},'snapshots':{k:v for k,v in s.items() if k.startswith('cash_')},'receipts':{}}
assert s['amount_yocto']=='10000000000000000000000'
assert s['measured_withdrawal_storage_growth_yocto']=='260000000000000000000'
assert s['one_transfer_withdrawal_margin_fixture']['target_free_margin_yocto']==s['amount_yocto']
assert s['withdrawal_margin_fixture']['target_free_margin_yocto']=='10260000000000000000000'
for k in ['failure_receipts_outcome','underfunded_withdrawal_receipts_outcome','withdrawal_receipts_outcome']:
 rows=s[k]; ids={r['id'] for r in rows}; assert len(ids)==len(rows)
 out['receipts'][k]=[{'id':r['id'],'executor':r['outcome']['executor_id'],'status':r['outcome']['status'],'children':r['outcome']['receipt_ids'],'fees':r['outcome']['tokens_burnt']} for r in rows]
 out.setdefault('unresolved_child_ids',{})[k]=[c for r in rows for c in r['outcome']['receipt_ids'] if c not in ids]
 if k=='underfunded_withdrawal_receipts_outcome':
  assert not any(r['outcome']['executor_id']==s['payer'] for r in rows)
 if k=='withdrawal_receipts_outcome':
  assert all('Failure' not in r['outcome']['status'] for r in rows)
  t=s['withdrawal_transaction_outcome']; assert t['id']==s['withdrawal_transaction_hash']; assert all(c in ids for c in t['outcome']['receipt_ids'])
fees=int(s['withdrawal_transaction_outcome']['outcome']['tokens_burnt'])+sum(int(r['outcome']['tokens_burnt']) for r in s['withdrawal_receipts_outcome'])
assert fees==int(s['withdrawal_fees_yocto']); assert int(s['payer_balance_after_yocto'])+fees==int(s['payer_balance_before_yocto'])+int(s['amount_yocto'])
out['balance_equation']={k:s[k] for k in ['payer_balance_before_yocto','payer_balance_after_yocto','withdrawal_fees_yocto']}; out['checks']='PASS exact expected quantities, unique receipt IDs and reported unresolved children, withdrawal success, no payer receipt on rejected withdrawal, and fee equation'
print(json.dumps(out,indent=2))
