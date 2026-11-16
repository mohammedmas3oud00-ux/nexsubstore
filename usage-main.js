(function(){
 'use strict';
 const form=document.getElementById('usage-form');if(!form)return;
 const output=document.getElementById('usage-feedback'),fileInput=document.getElementById('usage-qr');
 async function scan(file){
   if(file.size>5*1024*1024)throw Error('size');
   const img=await createImageBitmap(file);
   try{
     const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
     const scale=Math.min(1,1800/Math.max(img.width,img.height));
     canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
     ctx.drawImage(img,0,0,canvas.width,canvas.height);
     if('BarcodeDetector' in window){
       try{
         const codes=await new BarcodeDetector({formats:['qr_code']}).detect(canvas);
         if(codes.length)return codes[0].rawValue;
       }catch{}
     }
     if(typeof window.jsQR!=='function')throw Error('unsupported');
     const frame=ctx.getImageData(0,0,canvas.width,canvas.height);
     const code=window.jsQR(frame.data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});
     if(!code)throw Error('unreadable');
     return code.data;
   }finally{img.close()}
 }
 function present(data){
   if(!data.ok){
     output.textContent=({not_found:'رابط المتابعة أو رمز التفعيل غير مطابق.',not_ready:'الشريحة ما زالت قيد التجهيز.',provider_unavailable:'تعذر جلب بيانات الاستهلاك حاليًا.'})[data.error]||'تعذر عرض الاستهلاك حاليًا.';
     return;
   }
   output.textContent=(data.devices||[]).map((d,i)=>
     'الشريحة '+(i+1)+'\nالاستهلاك الإجمالي: '+(d.usage?.formatted??'غير متاح')+
     (d.daily?'\nالاستهلاك اليومي: '+d.daily.formatted:'')+
     (d.daily_reset_time!=null&&d.daily_reset_time!==''?'\nإعادة الضبط اليومية: '+String(d.daily_reset_time):'')).join('\n\n')||'لا تتوفر بيانات استهلاك.';
 }
 form.addEventListener('submit',async(e)=>{
   e.preventDefault();
   const button=form.querySelector('button[type=submit]');if(button.disabled)return;
   button.disabled=true;output.textContent='جارٍ التحقق...';
   try{
     const file=fileInput.files[0];
     const reference=file?await scan(file):document.getElementById('usage-reference').value.trim();
     if(!reference)throw Error('empty');
     // The QR payload is an opaque credential. Do NOT visit the decoded URL.
     const result=await fetch('/api/usage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference})});
     present(await result.json());
   }catch(error){output.textContent=error.message==='size'?'الصورة أكبر من 5 ميجابايت.':error.message==='empty'?'أدخل رابط المتابعة أو اختر QR.':'تعذر قراءة صورة QR أو الاستعلام عن الاستهلاك.';}
   finally{button.disabled=false}
 });
})();