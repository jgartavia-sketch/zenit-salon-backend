import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:55432/zenit_test';
process.env.JWT_SECRET ||= 'test-secret-for-email-adapter-only-2026-very-long';
const {config}=await import('../src/config.js');
const {sendBookingMail}=await import('../src/lib/email.js');
test('Adaptador de correo HTTPS: datos, idempotencia y errores sin secretos',async(t)=>{
 const saved={resendApiKey:config.resendApiKey,bookingEmailFrom:config.bookingEmailFrom};config.resendApiKey='qa-not-a-real-key';config.bookingEmailFrom='Zénit <citas@example.com>';
 const message={to:'client@example.com',subject:'Cita',text:'Confirmada',html:'<p>Confirmada</p>',messageId:'<zenit-qa@zenitsalon.com>'};
 try{
  await t.test('HTTPS a endpoint fijo con clave de idempotencia estable',async()=>{
   const result=await sendBookingMail(message,{fetchImpl:async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'zenit-qa@zenitsalon.com');const data=JSON.parse(options.body);assert.deepEqual(data.to,['client@example.com']);assert.equal(data.from,config.bookingEmailFrom);assert.equal(data.text,'Confirmada');return Response.json({id:'qa-id'});}});assert.equal(result.id,'qa-id');
  });
  await t.test('rechazo y timeout del proveedor quedan como error para reintento',async()=>{
   await assert.rejects(sendBookingMail(message,{fetchImpl:async()=>Response.json({secret:'must-not-log'},{status:429})}),e=>e.code==='RESEND_HTTP_429'&&!e.message.includes('secret'));
   await assert.rejects(sendBookingMail(message,{fetchImpl:async()=>{throw Object.assign(Error('timeout'),{code:'TIMEOUT'});}}),/timeout/);
  });
  await t.test('sin remitente verificado no intenta enviar',async()=>{config.bookingEmailFrom='';await assert.rejects(sendBookingMail(message,{fetchImpl:async()=>assert.fail('No enviar')}),e=>e.code==='BOOKING_FROM_MISSING');});
 }finally{Object.assign(config,saved);}
});
