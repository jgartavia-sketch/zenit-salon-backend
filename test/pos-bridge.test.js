import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSale,changeSale,updateStock} from '../src/lib/pos-bridge.js';
const enabled=!!process.env.TEST_DATABASE_URL;
test('Real PostgreSQL: shop reserve, POS sale, retry, invoice points, credit, reversal and concurrent last unit',{skip:!enabled},async t=>{
 const {PrismaClient}=await import('@prisma/client');
 const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
 const suffix=randomUUID();const actor='POS:integration';
 const category=await db.productCategory.create({data:{slug:'test-'+suffix,name:'QA'}});
 const customer=await db.user.create({data:{customerCode:'QA-'+suffix,name:'QA Customer',email:suffix+'@example.invalid',phone:'00000000',passwordHash:'not-a-login',role:'CUSTOMER'}});
 const product=await db.product.create({data:{slug:'qa-'+suffix,name:'QA Product',brand:'QA',description:'QA',price:10000,imageUrl:'/logo.png',stock:10,categoryId:category.id}});
 const shop=await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(724031)`;
  await tx.product.update({where:{id:product.id},data:{stock:{decrement:2}}});
  return tx.shopOrder.create({data:{customerId:customer.id,requestKey:randomUUID(),requestDigest:'test',items:[{productId:product.id,quantity:2,price:10000,subtotal:20000,tracked:true}],total:20000}});
 });
 const payload={operationKey:randomUUID(),saleKey:'QA:'+suffix,actor,shopOrderId:shop.id,customerId:customer.id,invoiceNumber:'QA-'+suffix,totalCents:2000000,credit:false,items:[{id:product.id,kind:'product',quantity:'2',unitPriceCents:1000000}]};
 await t.test('reserved shop stock is not decremented again',async()=>{await createSale(db,payload);assert.equal((await db.product.findUnique({where:{id:product.id}})).stock,8);assert.equal((await db.user.findUnique({where:{id:customer.id}})).purchasePoints,200);});
 await t.test('same operation is replayed and incompatible retry rejected',async()=>{await createSale(db,payload);assert.equal(await db.posSale.count({where:{key:payload.saleKey}}),1);await assert.rejects(createSale(db,{...payload,totalCents:1}),e=>e.status===409);});
 await t.test('refund restores reserved stock and reverses points once',async()=>{const p={operationKey:randomUUID(),saleKey:payload.saleKey,actor,reason:'QA refund'};await changeSale(db,p,'VOID');await changeSale(db,p,'VOID');assert.equal((await db.product.findUnique({where:{id:product.id}})).stock,10);assert.equal((await db.user.findUnique({where:{id:customer.id}})).purchasePoints,0);});
 const credit={...payload,operationKey:randomUUID(),saleKey:'QAC:'+suffix,shopOrderId:null,invoiceNumber:'QAC-'+suffix,totalCents:1000000,credit:true,items:[{id:product.id,kind:'product',quantity:'1',unitPriceCents:1000000}]};
 await t.test('credit changes stock immediately and awards only on settlement',async()=>{await createSale(db,credit);assert.equal((await db.user.findUnique({where:{id:customer.id}})).purchasePoints,0);const p={operationKey:randomUUID(),saleKey:credit.saleKey,actor,reason:'QA settlement'};await changeSale(db,p,'SETTLE');await changeSale(db,p,'SETTLE');assert.equal((await db.user.findUnique({where:{id:customer.id}})).purchasePoints,100);});
 await t.test('reopening and settling credit again does not lose or duplicate rewards',async()=>{await changeSale(db,{operationKey:randomUUID(),saleKey:credit.saleKey,actor,reason:'QA reopen'},'REOPEN');assert.equal((await db.user.findUnique({where:{id:customer.id}})).purchasePoints,0);await changeSale(db,{operationKey:randomUUID(),saleKey:credit.saleKey,actor,reason:'QA re-settle'},'SETTLE');assert.equal((await db.user.findUnique({where:{id:customer.id}})).purchasePoints,100);});
 await t.test('a staff-awarded invoice is reused, not rewarded a second time',async()=>{const invoice='QAS-'+suffix;await db.pointMovement.create({data:{userId:customer.id,type:'PURCHASE',points:100,amountColones:10000,invoiceNumber:invoice,description:'QA staff'}});await db.user.update({where:{id:customer.id},data:{purchasePoints:{increment:100}}});await createSale(db,{...credit,operationKey:randomUUID(),saleKey:'QAS:'+suffix,invoiceNumber:invoice,credit:false});assert.equal((await db.user.findUnique({where:{id:customer.id}})).purchasePoints,200);});
 await t.test('two simultaneous sales cannot consume the last unit twice',async()=>{await db.product.update({where:{id:product.id},data:{stock:1}});const inputs=[0,1].map(n=>({...credit,operationKey:randomUUID(),saleKey:'QAR:'+n+':'+suffix,invoiceNumber:'QAR-'+n+'-'+suffix,customerId:null,credit:false}));const result=await Promise.allSettled(inputs.map(x=>createSale(db,x)));assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal((await db.product.findUnique({where:{id:product.id}})).stock,0);});
 await t.test('stock adjustment replay does not duplicate units',async()=>{const p={operationKey:randomUUID(),actor,id:product.id,kind:'entry',quantity:3,reason:'QA restock'};await updateStock(db,p);await updateStock(db,p);assert.equal((await db.product.findUnique({where:{id:product.id}})).stock,3);});
 await db.$disconnect();
});
