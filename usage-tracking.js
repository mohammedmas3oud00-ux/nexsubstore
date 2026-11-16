(function(){
  const button=document.getElementById('show-usage'),out=document.getElementById('usage-result');if(!button)return;
  button.addEventListener('click',async()=>{
    if(button.disabled)return;
    button.disabled=true;out.textContent='جارٍ عرض الاستهلاك...';
    try{
      const r=await fetch('/api/usage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:location.href})});
      const data=await r.json();
      out.textContent=data.ok?data.devices.map((d,i)=>'الشريحة '+(i+1)+ '\nالاستهلاك الإجمالي: '+(d.usage?.formatted??'غير متاح')+
        (d.daily_entries?.length?'\nالاستهلاك اليومي:\n'+d.daily_entries.map(x=>(x.date?x.date+' · ':'')+x.amount).join('\n'):(d.daily?'\nالاستهلاك اليومي: '+d.daily.formatted:''))+
        (d.daily_reset_time!=null&&d.daily_reset_time!==''?'\nإعادة الضبط اليومية: '+String(d.daily_reset_time):'')).join('\n\n'):
        data.error==='not_ready'?'الشريحة قيد التجهيز.':'تعذر عرض الاستهلاك حاليًا.';
    }catch{out.textContent='تعذر الاتصال بخدمة الاستهلاك.'}
    finally{button.disabled=false}
  });
})();