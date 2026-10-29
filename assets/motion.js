// Independent HTML pages keep native navigation, history, and external links.
(()=>{
 const root=document.documentElement;
 const isHome=()=>['','index.html'].includes(location.pathname.split('/').pop());
 if(isHome())root.classList.add('home-entry');
 let replayFrame;
 function replayHome(){
  if(!isHome())return;
  cancelAnimationFrame(replayFrame);
  replayFrame=requestAnimationFrame(()=>{
   root.classList.remove('home-entry');
   void root.offsetWidth;
   root.classList.add('home-entry');
  });
 }
 addEventListener('pageswap',()=>root.classList.remove('home-entry'));
 addEventListener('pagereveal',event=>{
  if(isHome()){
   event.viewTransition?.skipTransition();
   replayHome();
  }else if(event.viewTransition){
   root.classList.add('native-route');
   event.viewTransition.finished.catch(()=>{});
  }
 });
 addEventListener('pageshow',event=>{
  if(event.persisted){
   if(isHome())replayHome();
   else root.classList.add('native-route');
  }
 });
})();
