(() => {
  'use strict';
  const REPO='CINEMABOT-star/MANGA', BRANCH='main', API=`https://api.github.com/repos/${REPO}`;
  const $=id=>document.getElementById(id);
  const state={text:null,prepared:null,page:0,key:null,busy:false,request:null,timer:null,polls:0};
  const inputs=['file','title','author','size','part','breaks'];
  function options(){return {version:1,title:$('title').value.trim(),author:$('author').value.trim(),font_size:Number($('size').value),pages_per_part:Number($('part').value),preserve_lines:$('breaks').checked};}
  function error(message){$('error').textContent=message;$('error').hidden=!message;}
  function status(message,isError=false){$('status-box').hidden=false;$('status-box').classList.toggle('error',isError);$('status').textContent=message;}
  function controls(){
    inputs.forEach(id=>$(id).disabled=state.busy);
    $('prepare').disabled=state.busy||!state.text;
    $('publish').disabled=state.busy||!state.prepared||!state.key||!!state.request;
    $('connect').disabled=state.busy;
    $('disconnect').disabled=state.busy;
    $('previous').disabled=!state.prepared||state.page===0;
    $('next').disabled=!state.prepared||state.page+1>=state.prepared.pages.length;
    $('progress').hidden=!state.busy;
  }
  function invalidate(){state.prepared=null;state.page=0;$('placeholder').hidden=false;$('page-label').textContent='Anteprima';$('summary').textContent='Premi Prepara anteprima per applicare le impostazioni.';controls();}
  function stopPolling(){clearTimeout(state.timer);state.timer=null;state.polls=0;}
  function releaseRequest(){stopPolling();state.request=null;$('check-status').hidden=true;$('run-link').hidden=true;}
  function preview(){Libro.draw($('preview'),state.prepared,state.page);$('placeholder').hidden=true;$('page-label').textContent=`${state.page+1} / ${state.prepared.pages.length}`;controls();}
  function fromBase64(value){const raw=atob(value.replace(/\s/g,''));return new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));}
  function base64(value){const bytes=new TextEncoder().encode(value);let result='';for(let offset=0;offset<bytes.length;offset+=8192)result+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(result);}
  async function api(path,method='GET',payload=null,missingOkay=false){
    if(!state.key)throw new Error('Collega GitHub prima di pubblicare.');
    const response=await fetch(path.startsWith('https:')?path:API+path,{method,cache:'no-store',credentials:'omit',headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+state.key,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
    if(missingOkay&&response.status===404)return null;
    if(!response.ok){
      const failure=new Error(response.status===401?'La chiave GitHub è scaduta o non valida. Collegala di nuovo.':response.status===403?'GitHub ha rifiutato l’accesso. Controlla MANGA e Contents: Read and write nella chiave; se hai fatto molti tentativi, attendi qualche minuto.':response.status===404?'Repository non accessibile: controlla che la chiave sia autorizzata per MANGA.':'GitHub non ha completato l’operazione. Riprova tra poco.');failure.status=response.status;throw failure;
    }
    return response.status===204?null:response.json();
  }
  async function checkReceipt(schedule=true){
    if(!state.request||!state.key)return;
    const requestId=state.request;
    try{
      const content=await api(`/contents/biblioteca-stato/${requestId}.json?ref=${BRANCH}`,'GET',null,true);
      if(state.request!==requestId)return;
      if(content){
        const receipt=JSON.parse(fromBase64(content.content));
        if(receipt.state==='ready'){
          stopPolling();state.busy=false;controls();$('check-status').hidden=true;
          status(`Libro pronto! ${receipt.pages} pagine in ${receipt.parts} ${receipt.parts===1?'parte':'parti'}. Sul lettore scegli Aggiorna catalogo, poi il libro. Se non compare subito, attendi qualche minuto e aggiorna ancora.`);
          return;
        }
        if(receipt.state==='error'){stopPolling();state.busy=false;controls();status('La preparazione si è fermata: '+receipt.message,true);$('check-status').hidden=false;return;}
      }
      status('TXT ricevuto. GitHub sta preparando e verificando le pagine. Puoi lasciare il PC spento; se chiudi questa pagina, il lavoro continua.');
    }catch(failure){status('Il TXT è stato inviato. Non riesco a leggere l’avanzamento: '+failure.message,true);}
    if(schedule&&++state.polls<225)state.timer=setTimeout(()=>checkReceipt(),8000);
    else{state.busy=false;controls();$('check-status').hidden=false;status('La richiesta è stata inviata. Usa Controlla di nuovo o segui la preparazione su GitHub.');}
  }
  $('file').addEventListener('change',async()=>{
    const file=$('file').files[0];if(!file)return;
    releaseRequest();invalidate();state.text=null;state.busy=true;error('');controls();
    try{
      if(file.size>20*1024*1024)throw new Error('Il TXT supera 20 MB. Dividilo in più volumi.');
      state.text=Libro.decode(new Uint8Array(await file.arrayBuffer()));
      $('filename').textContent=file.name;$('filehint').textContent=`${(file.size/1024).toLocaleString('it-IT',{maximumFractionDigits:0})} KB · testo pronto`;
      $('title').value=file.name.replace(/\.txt$/i,'').replace(/[_-]/g,' ').trim();
      $('status-box').hidden=true;
    }catch(failure){error(failure.message);$('filename').textContent='Scegli un file TXT';}
    finally{state.busy=false;controls();}
  });
  ['title','author','size','part','breaks'].forEach(id=>$(id).addEventListener('input',()=>{releaseRequest();invalidate();error('');}));
  $('prepare').addEventListener('click',async()=>{
    state.busy=true;releaseRequest();error('');status('Preparo l’anteprima su questo dispositivo…');controls();
    try{const selected=options();const layout=await Libro.layout(state.text,selected);state.prepared={text:state.text,options:selected,...layout};state.page=0;preview();$('summary').textContent=`Circa ${layout.pages.length} pagine · ${Math.ceil(layout.pages.length/selected.pages_per_part)} parti. Lettere Atkinson, pensate per essere leggibili.`;status('Controlla le pagine. Quando sei pronto, pubblica il libro.');}
    catch(failure){invalidate();error(failure.message);status('Anteprima non preparata.',true);}
    finally{state.busy=false;controls();}
  });
  $('previous').addEventListener('click',()=>{if(state.prepared&&state.page>0){state.page--;preview();}});
  $('next').addEventListener('click',()=>{if(state.prepared&&state.page+1<state.prepared.pages.length){state.page++;preview();}});
  $('connect').addEventListener('click',async()=>{
    const key=$('token').value.trim();$('token').value='';if(!key){status('Incolla la chiave dedicata a MANGA.',true);return;}
    state.key=key;state.busy=true;controls();
    try{
      const user=await api('https://api.github.com/user');const repository=await api('');
      if(!repository.permissions?.push)throw new Error('Questo account non può pubblicare su CINEMABOT-star/MANGA.');
      $('account').textContent='Collegato: '+user.login;$('dot').classList.add('on');$('disconnect').hidden=false;$('access').open=false;status('GitHub collegato. Puoi pubblicare il libro.');
    }catch(failure){state.key=null;status(failure.message,true);}
    finally{state.busy=false;controls();}
  });
  $('disconnect').addEventListener('click',()=>{state.key=null;$('token').value='';stopPolling();$('account').textContent='GitHub da collegare';$('dot').classList.remove('on');$('disconnect').hidden=true;controls();status('GitHub scollegato.');});
  $('publish').addEventListener('click',async()=>{
    if(!state.prepared||!state.key||state.busy)return;
    state.busy=true;error('');controls();status('Invio il TXT e le impostazioni a GitHub…');
    let pushed=false;
    try{
      const prepared=state.prepared;const settings=JSON.stringify(prepared.options);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('BIBLIOTECA_REQUEST_V1\0'+prepared.text+'\0'+settings));
      const requestId=[...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      const folder=`biblioteca-input/${requestId}`;
      const previous=await api(`/contents/${folder}/richiesta.json?ref=${BRANCH}`,'GET',null,true);
      if(!previous){
        const textBlob=await api('/git/blobs','POST',{content:base64(prepared.text),encoding:'base64'});
        const optionsBlob=await api('/git/blobs','POST',{content:settings+'\n',encoding:'utf-8'});
        const files=[{path:folder+'/testo.txt',mode:'100644',type:'blob',sha:textBlob.sha},{path:folder+'/richiesta.json',mode:'100644',type:'blob',sha:optionsBlob.sha}];
        for(let attempt=0;attempt<3;attempt++){
          const head=await api(`/git/ref/heads/${BRANCH}`);
          const parent=await api('/git/commits/'+head.object.sha);
          const tree=await api('/git/trees','POST',{base_tree:parent.tree.sha,tree:files});
          const commit=await api('/git/commits','POST',{message:'Import TXT: '+prepared.options.title,tree:tree.sha,parents:[head.object.sha]});
          try{await api(`/git/refs/heads/${BRANCH}`,'PATCH',{sha:commit.sha,force:false});pushed=true;break;}
          catch(failure){if(![409,422].includes(failure.status)||attempt===2)throw failure;}
        }
      }else pushed=true;
      state.request=requestId;
      $('run-link').href=`https://github.com/${REPO}/actions/workflows/biblioteca.yml`;$('run-link').hidden=false;
      // Only the harmless request identifier is retained, so an iPhone can resume polling.
      try{localStorage.setItem('biblioteca-ultima-richiesta',requestId);}catch{}
      await checkReceipt();
    }catch(failure){state.busy=false;status((pushed?'TXT inviato. ':'Pubblicazione non completata. ')+failure.message,true);controls();}
  });
  $('check-status').addEventListener('click',()=>{stopPolling();checkReceipt(false);});
  window.addEventListener('beforeunload',event=>{if(state.busy&&!state.request){event.preventDefault();event.returnValue='';}});
  // Recover a pending job without storing the GitHub key or the book itself.
  try{const last=localStorage.getItem('biblioteca-ultima-richiesta');if(/^[a-f0-9]{64}$/.test(last||'')){state.request=last;$('check-status').hidden=false;$('run-link').href=`https://github.com/${REPO}/actions/workflows/biblioteca.yml`;$('run-link').hidden=false;status('Hai già inviato un libro. Collega GitHub e premi Controlla di nuovo per vedere se è pronto.');}}catch{}
  controls();
})();
