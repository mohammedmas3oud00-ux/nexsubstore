(function(){
  try {
    var key='nexsub_visitor_id';
    var id=localStorage.getItem(key);
    if(!/^[0-9a-f-]{36}$/.test(id || '')){
      id=crypto.randomUUID();
      localStorage.setItem(key,id);
    }
    fetch('/api/visit',{method:'POST',body:id,keepalive:true}).catch(function(){});
  } catch (_) {}
})();
