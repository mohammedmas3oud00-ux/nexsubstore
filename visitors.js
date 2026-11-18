(function(){
  function showCount(count){
    var box=document.getElementById('monthly-visitors');
    var num=document.getElementById('monthly-visitors-count');
    if(!box||!num||typeof count!=='number') return;
    num.textContent=count.toLocaleString('en-US');
    box.hidden=false;
  }
  try {
    var key='nexsub_visitor_id';
    var id=localStorage.getItem(key);
    if(!/^[0-9a-f-]{36}$/.test(id || '')){
      id=crypto.randomUUID();
      localStorage.setItem(key,id);
    }
    fetch('/api/visit',{method:'POST',body:id,keepalive:true})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ if(d&&d.ok&&typeof d.count==='number') showCount(d.count); })
      .catch(function(){});
  } catch (_) {
    fetch('/api/visit')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ if(d&&d.ok&&typeof d.count==='number') showCount(d.count); })
      .catch(function(){});
  }
})();
