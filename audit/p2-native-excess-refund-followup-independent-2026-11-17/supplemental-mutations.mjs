import {readFileSync} from 'node:fs';
const {validateNativeExcessRefundCapture:v}=await import(process.cwd()+'/tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs');
const base=JSON.parse(readFileSync('tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17.json'));
for(const [name,mut] of Object.entries({
 disconnected:s=>{s.withdrawal_receipts_outcome.push({id:'unreachable',outcome:{receipt_ids:[],status:{SuccessValue:''},tokens_burnt:'0'}});s.withdrawal_receipts.push({receipt_id:'unreachable',predecessor_id:'system',receiver_id:s.payer,receipt:{Action:{actions:[]}}});},
 failedPayout:s=>{const b=s.withdrawal_receipts.find(b=>b.predecessor_id==='lcp-core-sandbox.sandbox'&&b.receiver_id===s.payer);s.withdrawal_receipts_outcome.find(o=>o.id===b.receipt_id).outcome.status={Failure:{ActionError:{kind:'synthetic failure'}}};},
 emptyStatus:s=>{for(const o of s.withdrawal_receipts_outcome)o.outcome.status={};},
 extraReplayPayout:s=>{const b=s.replay_receipts[0];b.predecessor_id='lcp-core-sandbox.sandbox';b.receiver_id=s.payer;b.receipt.Action.actions.push({Transfer:{deposit:'1'}});}
})){const c=structuredClone(base);try{mut(c.scenarios.native_excess_refund_cash_gate);v(c);console.log(name+': ACCEPTED');}catch(e){console.log(name+': REJECTED '+e.message);}}
