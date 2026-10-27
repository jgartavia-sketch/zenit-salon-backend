// Disabled until the POS implements this provider. Never exposed to browser code.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { secretEqual } from "../lib/security.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { validDate, instant } from "../lib/agenda.js";
import { z } from "zod";
const router = Router();
router.use(
  (req, res, next) => {
    const key = process.env.ZENIT_CONNECT_KEY;
    if (!key || key.length < 32)
      return res
        .status(503)
        .json({ error: "Integración pendiente de configuración." });
    if (!secretEqual(req.get("x-systemlab-key"), key))
      return res.status(401).json({ error: "Acceso no autorizado." });
    next();
  },
  rateLimit("pos-connect", 300, 1),
);
router.get("/catalog", async (_req, res, next) => {
  try {
    res.json({
      provider: "zenit",
      contractVersion: 2,
      products: await prisma.product.findMany({
        include: { category: {select:{id:true,name:true,active:true}} },
      }),
      services: await prisma.salonService.findMany({
        include: { category: {select:{id:true,name:true,active:true}} },
      }),
    });
  } catch (e) {
    next(e);
  }
});
router.get('/appointments',async(req,res,next)=>{
 try{
  const date=z.string().refine(validDate).parse(req.query.date);
  const appointments=await prisma.appointment.findMany({where:{startAt:{gte:instant(date,'00:00'),lt:new Date(+instant(date,'00:00')+86400000)}},orderBy:{startAt:'asc'}});
  res.json({provider:'zenit',timeZone:'America/Costa_Rica',appointments:appointments.map(a=>({...a,status:a.status==='PENDING'&&+a.expiresAt<=Date.now()?'EXPIRED':a.status}))});
 }catch(e){next(e);}
});
export default router;

// All mutations below execute only after private key authentication above.
import {createSale,changeSale,updateStock,operation} from '../lib/pos-bridge.js';
import {createManual,updateAppointment} from './agenda.routes.js';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.get('/customers',wrap(async(req,res)=>{
 const offset=z.coerce.number().int().min(0).max(1000000).parse(req.query.offset||0);
 const limit=z.coerce.number().int().min(1).max(200).parse(req.query.limit||200);
 const customers=await prisma.user.findMany({where:{role:'CUSTOMER',active:true},select:{id:true,name:true,email:true,phone:true,customerCode:true,purchasePoints:true,referralPoints:true},orderBy:{id:'asc'},skip:offset,take:limit});
 res.json({provider:'zenit',customers,nextOffset:customers.length===limit?offset+limit:null});
}));
router.get('/orders',wrap(async(req,res)=>{
 const offset=z.coerce.number().int().min(0).max(1000000).parse(req.query.offset||0);
 const orders=await prisma.shopOrder.findMany({include:{customer:{select:{id:true,name:true,email:true,phone:true}}},orderBy:{createdAt:'desc'},skip:offset,take:100});
 res.json({provider:'zenit',orders,nextOffset:orders.length===100?offset+100:null});
}));
router.get('/orders/:id',wrap(async(req,res)=>{
 const order=await prisma.shopOrder.findUnique({where:{id:z.uuid().parse(req.params.id)},include:{customer:{select:{id:true,name:true,email:true,phone:true}}}});
 if(!order)return res.status(404).json({error:'Pedido no encontrado.'});res.json({provider:'zenit',order});
}));
router.post('/sales',wrap(async(req,res)=>res.json(await createSale(prisma,req.body))));
for(const action of ['settle','reopen','void'])router.post('/sales/'+action,wrap(async(req,res)=>res.json(await changeSale(prisma,req.body,action.toUpperCase()))));
router.post('/inventory',wrap(async(req,res)=>res.json(await updateStock(prisma,req.body))));
router.post('/appointments',wrap(async(req,res)=>{
 const {actor,operationKey,...input}=z.object({operationKey:z.uuid(),actor:z.string().min(1).max(100)}).passthrough().parse(req.body);
 res.json({provider:'zenit',appointment:await createManual(input,actor)});
}));
router.patch('/appointments/:id',wrap(async(req,res)=>{
 const {actor,operationKey,...input}=z.object({operationKey:z.uuid(),actor:z.string().min(1).max(100)}).passthrough().parse(req.body);
 res.json({provider:'zenit',appointment:await updateAppointment(req.params.id,input,actor,operationKey)});
}));
router.post('/catalog/update',wrap(async(req,res)=>{
 const p=z.object({operationKey:z.uuid(),actor:z.string().min(1).max(100),id:z.uuid(),kind:z.enum(['product','service']),name:z.string().trim().min(1).max(160),price:z.number().int().min(0).max(100000000),active:z.boolean()}).strict().parse(req.body);
 res.json(await operation(prisma,p,async tx=>{
  const model=p.kind==='product'?tx.product:tx.salonService;
  await model.update({where:{id:p.id},data:{name:p.name,price:p.price,active:p.active}});
  return {provider:'zenit',action:'CATALOG',id:p.id};
 }));
}));

router.post('/appointments/update',wrap(async(req,res)=>{
 const {id,actor,operationKey,...input}=z.object({id:z.uuid(),actor:z.string().min(1).max(100),operationKey:z.uuid()}).passthrough().parse(req.body);
 res.json({provider:'zenit',appointment:await updateAppointment(id,input,actor,operationKey)});
}));

import {cancelOrder} from './orders.routes.js';
router.post('/orders/cancel',wrap(async(req,res)=>{
 const p=z.object({operationKey:z.uuid(),actor:z.string().min(1).max(100),id:z.uuid()}).strict().parse(req.body);
 res.json(await operation(prisma,p,async tx=>{await cancelOrder(tx,p.id);return {provider:'zenit',action:'ORDER_CANCEL',id:p.id};}));
}));
