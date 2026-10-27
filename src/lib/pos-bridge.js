import {z} from 'zod';
import {digest,httpError} from './security.js';
import {pointsFromColones} from './points.js';
const key=z.string().min(8).max(100).regex(/^[a-zA-Z0-9:_-]+$/);
const cents=z.number().int().min(0).max(10000000000);
const invoice=z.string().trim().min(1).max(100).transform(x=>x.replace(/\s+/g,' ').toUpperCase());
const actor=z.string().min(1).max(100);
export const saleSchema=z.object({operationKey:key,saleKey:key,actor,shopOrderId:z.uuid().nullable(),customerId:z.uuid().nullable(),invoiceNumber:invoice,totalCents:cents,credit:z.boolean(),items:z.array(z.object({id:z.uuid(),kind:z.enum(['product','service']),quantity:z.string().regex(/^\d+(\.\d{1,3})?$/),unitPriceCents:cents}).strict()).min(1).max(200)}).strict();
export const changeSchema=z.object({operationKey:key,saleKey:key,actor,reason:z.string().trim().min(3).max(500)}).strict();
export const stockSchema=z.object({operationKey:key,actor,id:z.uuid(),kind:z.enum(['entry','exit','adjustment']),quantity:z.number().int().min(0).max(999999999),reason:z.string().trim().min(3).max(500)}).strict();
export async function operation(prisma, input, fn){
 return prisma.$transaction(async tx=>{
  // Same lock order as site stock and invoice operations; no split-brain inventory.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(724031)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(724032)`;
  const hash=digest(input);const old=await tx.posOperation.findUnique({where:{key:input.operationKey}});
  if(old){if(old.digest!==hash)throw httpError(409,'Operación repetida con datos diferentes.');return old.result;}
  const result=await fn(tx);
  await tx.posOperation.create({data:{key:input.operationKey,digest:hash,result}});
  await tx.auditEvent.create({data:{actorId:input.actor,action:'POS_'+result.action,targetId:input.saleKey||input.id}});
  return result;
 },{maxWait:15000,timeout:20000});
}
async function award(tx,sale,operationKey){
 if(!sale.customerId)return {id:null,owns:false};
 const user=await tx.user.findFirst({where:{id:sale.customerId,active:true,role:'CUSTOMER'}});
 if(!user)throw httpError(409,'El cliente ya no está activo.');
 const amount=Math.floor(Number(sale.totalCents)/100),points=pointsFromColones(amount);
 const existing=await tx.pointMovement.findFirst({where:{invoiceNumber:{equals:sale.invoiceNumber,mode:'insensitive'}}});
 if(existing){
  if(existing.userId!==user.id||existing.amountColones!==amount||existing.type!=='PURCHASE')throw httpError(409,'Factura ya asociada a otra operación.');
  if(sale.pointsMovementId===existing.id && !sale.pointsActive){
   await tx.user.update({where:{id:user.id},data:{purchasePoints:{increment:existing.points}}});
   await tx.pointMovement.create({data:{userId:user.id,type:'ADJUSTMENT',points:existing.points,referenceId:'POS-REAWARD:'+operationKey,description:'Reliquidación POS '+sale.invoiceNumber}});
  }
  return {id:existing.id,owns:false};
 }
 if(!points)return {id:null,owns:false};
 const movement=await tx.pointMovement.create({data:{userId:user.id,type:'PURCHASE',points,amountColones:amount,invoiceNumber:sale.invoiceNumber,referenceId:'POS:'+sale.key,description:'Venta POS '+sale.invoiceNumber}});
 await tx.user.update({where:{id:user.id},data:{purchasePoints:{increment:points}}});
 return {id:movement.id,owns:true};
}
async function reversePoints(tx,sale,operationKey){
 if(!sale.pointsMovementId||!sale.pointsActive)return;
 const movement=await tx.pointMovement.findUnique({where:{id:sale.pointsMovementId}});
 // An invoice awarded by staff is the same sale; its reversal is also unique.
 if(!movement||movement.type!=='PURCHASE')throw httpError(409,'Revisá la trazabilidad de puntos de esta factura.');
 const referenceId='POS-REV:'+operationKey;
 if(await tx.pointMovement.findUnique({where:{referenceId}}))return;
 const changed=await tx.user.updateMany({where:{id:movement.userId,purchasePoints:{gte:movement.points}},data:{purchasePoints:{decrement:movement.points}}});
 if(!changed.count)throw httpError(409,'Puntos ya utilizados: resolver el saldo de fidelización antes de anular.');
 await tx.pointMovement.create({data:{userId:movement.userId,type:'REVERSAL',points:-movement.points,referenceId,description:'Reversión venta POS '+sale.invoiceNumber}});
}
export async function createSale(prisma,raw){
 const p=saleSchema.parse(raw);
 const identities=p.items.map(i=>i.kind+':'+i.id);if(new Set(identities).size!==identities.length)throw httpError(400,'Artículos repetidos.');
 return operation(prisma,p,async tx=>{
  if(await tx.posSale.findUnique({where:{key:p.saleKey}}))throw httpError(409,'La venta ya está registrada.');
  if(p.customerId&&!await tx.user.findFirst({where:{id:p.customerId,role:'CUSTOMER',active:true}}))throw httpError(409,'Cliente no disponible.');
  const shop=p.shopOrderId?await tx.shopOrder.findUnique({where:{id:p.shopOrderId}}):null;
  if(p.shopOrderId&&(!shop||shop.status!=='PENDING'||shop.customerId!==p.customerId))throw httpError(409,'Pedido cancelado, cerrado o de otro cliente.');
  if(shop){
   if(shop.total*100!==p.totalCents||p.items.some(i=>i.kind!=='product'))throw httpError(409,'El pedido original cambió.');
   const canonical=arr=>JSON.stringify([...arr].map(i=>[i.id||i.productId,Number(i.quantity),i.unitPriceCents??i.price*100]).sort((a,b)=>a[0].localeCompare(b[0])));
   if(canonical(shop.items)!==canonical(p.items))throw httpError(409,'Los artículos difieren del pedido original.');
  }
  const snapshot=[];
  for(const item of [...p.items].sort((a,b)=>a.id.localeCompare(b.id))){
   const qty=Number(item.quantity);if(!Number.isFinite(qty)||qty<=0||qty>999999)throw httpError(400,'Cantidad inválida.');
   const model=item.kind==='product'?tx.product:tx.salonService;
   const record=await model.findFirst({where:{id:item.id,active:true,category:{active:true}}});
   if(!record)throw httpError(409,'Artículo inactivo o eliminado.');
   let tracked=false;
   if(item.kind==='product'){
    if(!Number.isInteger(qty))throw httpError(400,'Los productos físicos requieren cantidades enteras.');
    tracked=shop?!!shop.items.find(i=>i.productId===item.id)?.tracked:record.stock!==null;
    if(!shop){
     if(!record.available)throw httpError(409,'Producto no disponible.');
     if(tracked){const changed=await tx.product.updateMany({where:{id:item.id,stock:{gte:qty}},data:{stock:{decrement:qty}}});if(!changed.count)throw httpError(409,'Stock insuficiente.');}
    }
   }
   snapshot.push({...item,tracked});
  }
  let sale=await tx.posSale.create({data:{key:p.saleKey,shopOrderId:p.shopOrderId,customerId:p.customerId,invoiceNumber:p.invoiceNumber,totalCents:BigInt(p.totalCents),status:p.credit?'CREDIT':'PAID',items:snapshot}});
  if(!p.credit){const point=await award(tx,sale,p.operationKey);sale=await tx.posSale.update({where:{key:p.saleKey},data:{pointsMovementId:point.id,ownsPoints:point.owns,pointsActive:!!point.id}});}
  if(shop)await tx.shopOrder.update({where:{id:shop.id},data:{status:'COMPLETED'}});
  return {provider:'zenit',action:'SALE',saleKey:p.saleKey,invoiceNumber:sale.invoiceNumber,status:sale.status};
 });
}
export async function changeSale(prisma,raw,action){
 const p=changeSchema.parse(raw);
 return operation(prisma,{...p,action},async tx=>{
  const sale=await tx.posSale.findUnique({where:{key:p.saleKey}});if(!sale)throw httpError(404,'Venta no encontrada.');
  if(sale.status==='VOID')throw httpError(409,'Venta anulada.');
  let data;
  if(action==='SETTLE'){
   if(sale.status!=='CREDIT')throw httpError(409,'El crédito ya fue liquidado.');
   const point=await award(tx,sale,p.operationKey);data={status:'PAID',pointsMovementId:point.id,ownsPoints:point.owns,pointsActive:!!point.id};
  }else if(action==='REOPEN'){
   if(sale.status!=='PAID')throw httpError(409,'La venta no está pagada.');
   await reversePoints(tx,sale,p.operationKey);data={status:'CREDIT',pointsActive:false};
  }else if(action==='VOID'){
   await reversePoints(tx,sale,p.operationKey);
   for(const i of sale.items)if(i.kind==='product'&&i.tracked)await tx.product.update({where:{id:i.id},data:{stock:{increment:Number(i.quantity)}}});
   if(sale.shopOrderId)await tx.shopOrder.update({where:{id:sale.shopOrderId},data:{status:'REFUNDED'}});
   data={status:'VOID',pointsActive:false};
  }else throw httpError(400,'Acción inválida.');
  await tx.posSale.update({where:{key:p.saleKey},data});
  return {provider:'zenit',action,saleKey:p.saleKey,status:data.status};
 });
}
export async function updateStock(prisma,raw){
 const p=stockSchema.parse(raw);
 return operation(prisma,p,async tx=>{
  const record=await tx.product.findUnique({where:{id:p.id}});if(!record||record.stock===null)throw httpError(409,'Este producto no controla existencias.');
  const next=p.kind==='entry'?record.stock+p.quantity:p.kind==='exit'?record.stock-p.quantity:p.quantity;
  if(next<0||next>999999999)throw httpError(409,'Existencias insuficientes o fuera de rango.');
  await tx.product.update({where:{id:p.id},data:{stock:next}});
  return {provider:'zenit',action:'STOCK',id:p.id,stock:next,delta:next-record.stock};
 });
}
