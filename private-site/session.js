document.getElementById('corporate-logout')?.addEventListener('click',async()=>{try{await fetch('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'}});}finally{location.assign('/login');}});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
