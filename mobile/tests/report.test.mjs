import { dayModel, sumModels, statusOf } from '../../src/mobile/report.js';
import assert from 'node:assert/strict';
// 10/21 실제 보고서 숫자로 만든 스냅샷 (매입+순이익 보고서 기준)
const R=(brand,isB2B,b2bName,item,count,sales,purchase,fee,vat)=>({brand,isB2B,b2bName,item,option:'',count,sales,purchase,fee,vat,profit:sales-purchase-fee-vat});
const snap={status:'confirmed',data:{date:'2026-10-21',adTotal:0,rows:[
 R('그로븐',false,'','업소용 깐마늘',2,317980,260000,38158,0),
 R('그로븐',true,'직거래','깐마늘',1,300000,260000,0,0),
 R('옐로우브릿지',false,'','간고등어',6,225660,162000,27079,0),
 R('옐로우브릿지',false,'','마그네슘',3,75300,20607,9036,4972),
 R('옐로우브릿지',false,'','현미 뻥튀기',8,71820,50080,8621,1976),
 R('옐로우브릿지',false,'','목전지',2,49760,19600,5972,0),
 R('옐로우브릿지',true,'또또컴퍼니','엮은굴비',3,70800,67500,0,0),
 R('옐로우브릿지',true,'또또컴퍼니','박대',1,16900,16000,0,0)],
 plat:{그로븐:{쿠팡:{count:2,sales:317980}},옐로우브릿지:{쿠팡:{count:19,sales:422540}}}}};
const m=dayModel(snap);
assert.equal(m.sales,1128220); assert.equal(m.profit,176619); assert.equal(m.count,26);
assert.equal(m.biz.그로븐.sales,617980); assert.equal(m.biz.그로븐.profit,59822);
assert.equal(m.biz.옐로우브릿지.profit,116797); assert.equal(m.b2b,387700);
assert.equal(m.biz.옐로우브릿지.channels['또또컴퍼니'].profit,4200);
// 폰 입력 문자매출이 더해지는지
const m2=dayModel(snap,[{business:'그로븐',item:'깐마늘',qty:2,sales:120000,buy:98000}]);
assert.equal(m2.sales,1248220); assert.equal(m2.biz.그로븐.channels['직거래'].profit,62000);
// 매입 미입력이면 매입 0으로
assert.equal(dayModel(null,[{business:'그로븐',item:'x',qty:1,sales:1000,buy:null}]).profit,1000);
// 합치기
const s=sumModels([m,m]); assert.equal(s.sales,2256440); assert.equal(s.biz.옐로우브릿지.channels['자사몰'].items['간고등어'].count,12);
assert.equal(statusOf(snap,'2026-10-21','2026-10-24'),'done');
assert.equal(statusOf({status:'draft'},'2026-10-22','2026-10-24'),'check');
assert.equal(statusOf(null,'2026-10-24','2026-10-24'),'live');
console.log('report.js OK');
