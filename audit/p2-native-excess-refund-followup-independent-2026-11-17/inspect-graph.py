import json,sys
c=json.load(open(sys.argv[1]));s=c['scenarios']['native_excess_refund_cash_gate'];r={'node':c['node'],'artifacts':c['wasm_artifacts'],'transactions':{}}
for prefix in ['failure','underfunded_withdrawal','withdrawal','replay']:
 o=s[prefix+'_receipts_outcome'];b=s[prefix+'_receipts'];t=s[prefix+'_transaction_outcome'];oi={v['id']:v for v in o};bi={v['receipt_id']:v for v in b};seen=set();todo=list(t['outcome']['receipt_ids'])
 while todo:
  k=todo.pop()
  if k in seen:continue
  seen.add(k);todo+=oi.get(k,{}).get('outcome',{}).get('receipt_ids',[])
 assert len(oi)==len(o)==len(bi)==len(b)
 assert seen==set(oi)==set(bi)
 assert all(len(v['outcome']['status'])==1 and 'Unknown' not in v['outcome']['status'] for v in o)
 rows=[]
 for k,v in oi.items():
  body=bi[k];rows.append({'id':k,'children':v['outcome']['receipt_ids'],'executor':v['outcome']['executor_id'],'status':v['outcome']['status'],'logs':v['outcome']['logs'],'predecessor':body['predecessor_id'],'receiver':body['receiver_id'],'actions':body.get('receipt',{}).get('Action',{}).get('actions',[])})
 r['transactions'][prefix]={'hash':s[prefix+'_transaction_hash'],'final':s[prefix+'_final_execution_status'],'status':s[prefix+'_status'],'root':t,'graph_closed':True,'receipts':rows}
r['accounting']={k:v for k,v in s.items() if any(x in k for x in ['cash_','credit_','balance_','fees_','growth_','margin_fixture'])}
print(json.dumps(r,indent=2))
