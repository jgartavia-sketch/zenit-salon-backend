import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const url=process.env.TEST_DATABASE_URL;
test('POS conserva avisos, motivo de rechazo y aceptación de propuesta del sitio',{skip:!url},async t=>{
 const target=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&target.pathname==='/zenit_test','Usá solo la base local desechable zenit_test.');
 process.env.DATABASE_URL=url;process.env.JWT_SECRET='isolated-booking-pos-test-secret-long-enough-2026';process.env.ZENIT_CONNECT_KEY='isolated-pos-connect-not-a-real-key-2026';
 const {prisma}=await import('../src/lib/prisma.js');const {app}=await import('../src/app.js');const {signToken}=await import('../src/middleware/auth.js');const {config}=await import('../src/config.js');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;const suffix=randomUUID();
 const createUser=role=>prisma.user.create({data:{name:'QA '+role,email:randomUUID()+'@example.com',phone:'00000000',customerCode:randomUUID(),passwordHash:'unusable-test-hash',role}});
 const owner=await createUser('ADMIN'),customer=await createUser('CUSTOMER'),other=await createUser('CUSTOMER');
 const ownerEmail=config.bookingOwnerEmail;config.bookingOwnerEmail=owner.email;
 const category=await prisma.serviceCategory.create({data:{slug:suffix,name:'QA',eyebrow:'QA',description:'QA'}});
 const service=await prisma.salonService.create({data:{slug:'qa-'+suffix,name:'QA corte',categoryId:category.id,mode:'RESERVE',price:5000,durationMinutes:60}});
 const day=new Date(Date.now()+40*86400000).toISOString().slice(0,10);
 const originalSettings=await prisma.agendaConfig.findUnique({where:{id:1}});
 await prisma.agendaConfig.upsert({where:{id:1},create:{id:1,weekly:[],overrides:[{date:day,ranges:[{start:'09:00',end:'17:00'}]}],noticeMinutes:0},update:{overrides:[{date:day,ranges:[{start:'09:00',end:'17:00'}]}],noticeMinutes:0}});
 async function call(path,method='GET',body,token,privateKey=false){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(privateKey?{'X-SystemLab-Key':process.env.ZENIT_CONNECT_KEY}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
 const token=signToken(customer);let booking,proposal;
 try{
 await t.test('la solicitud web conserva mensaje de éxito y avisos a dueña/clienta',async()=>{
  const r=await call('/api/agenda/appointments','POST',{requestKey:randomUUID(),date:day,time:'09:00',services:[service.slug]},token);assert.equal(r.status,201);assert.match(r.data.message,/enviada con éxito/);booking=r.data.appointment;
  assert.equal(await prisma.emailDelivery.count({where:{eventKey:{startsWith:booking.id+':REQUESTED'}}}),2);
 });
 const confirm={operationKey:randomUUID(),id:booking.id,actor:'POS:QA:owner',status:'CONFIRMED'};
 await t.test('confirmar desde POS usa el mismo aviso y el reintento no duplica correos',async()=>{
  for(let n=0;n<2;n++)assert.equal((await call('/api/pos-connect/appointments/update','POST',confirm,null,true)).status,200);
  assert.equal(await prisma.emailDelivery.count({where:{eventKey:{startsWith:booking.id+':CONFIRMED'}}}),1);
 });
 await t.test('la ruta privada mantiene el motivo obligatorio para la clienta',async()=>{
  const r=await call('/api/pos-connect/appointments/update','POST',{operationKey:randomUUID(),id:booking.id,actor:'POS:QA:owner',status:'CANCELLED'},null,true);assert.equal(r.status,400);
  assert.equal((await prisma.appointment.findUnique({where:{id:booking.id}})).status,'CONFIRMED');
 });
 await t.test('rechazo desde POS conserva texto, propuesta y un solo aviso',async()=>{
  const body={operationKey:randomUUID(),id:booking.id,actor:'POS:QA:owner',status:'CANCELLED',responseMessage:'Imprevisto del salón. Te proponemos otra hora.',proposedDate:day,proposedTime:'11:00'};
  for(let n=0;n<2;n++)assert.equal((await call('/api/pos-connect/appointments/update','POST',body,null,true)).status,200);
  const saved=await prisma.appointment.findUnique({where:{id:booking.id}});assert.match(saved.responseMessage,/Imprevisto/);assert.ok(saved.proposedStartAt);proposal=saved;
  assert.equal(await prisma.emailDelivery.count({where:{eventKey:{startsWith:booking.id+':CANCELLED'}}}),1);
  const mail=await prisma.emailDelivery.findFirst({where:{eventKey:{startsWith:booking.id+':CANCELLED'}}});assert.match(mail.text,/Imprevisto/);assert.match(mail.text,/Propuesta:/);
  assert.equal(await prisma.appointment.count({where:{startAt:saved.proposedStartAt,status:{in:['PENDING','CONFIRMED']}}}),0);
 });
 await t.test('la clienta acepta en el sitio sin duplicar solicitud, con aislamiento',async()=>{
  assert.equal((await call(`/api/agenda/appointments/${booking.id}/accept-proposal`,'POST',null,signToken(other))).status,404);
  const first=await call(`/api/agenda/appointments/${booking.id}/accept-proposal`,'POST',null,token);assert.equal(first.status,201);assert.equal(first.data.appointment.status,'PENDING');
  const again=await call(`/api/agenda/appointments/${booking.id}/accept-proposal`,'POST',null,token);assert.equal(again.status,201);assert.equal(first.data.appointment.id,again.data.appointment.id);
  assert.equal(await prisma.emailDelivery.count({where:{eventKey:{startsWith:first.data.appointment.id+':REQUESTED'}}}),2);
  const mine=await call('/api/agenda/mine','GET',null,token);const original=mine.data.appointments.find(a=>a.id===booking.id);assert.equal(original.proposalAppointmentId,first.data.appointment.id);assert.match(original.responseMessage,/Imprevisto/);
 });
 }finally{
 config.bookingOwnerEmail=ownerEmail;
 await prisma.emailDelivery.deleteMany({where:{recipient:{in:[owner.email,customer.email,other.email]}}});
 await prisma.appointment.deleteMany({where:{customerId:{in:[owner.id,customer.id,other.id]}}});
 await prisma.user.deleteMany({where:{id:{in:[owner.id,customer.id,other.id]}}});
 await prisma.salonService.delete({where:{id:service.id}});await prisma.serviceCategory.delete({where:{id:category.id}});
 if(originalSettings){const {weekly,overrides,holdHours,noticeMinutes}=originalSettings;await prisma.agendaConfig.update({where:{id:1},data:{weekly,overrides,holdHours,noticeMinutes}});}else await prisma.agendaConfig.deleteMany({where:{id:1}});
 await new Promise(r=>server.close(r));await prisma.$disconnect();
 }
});
