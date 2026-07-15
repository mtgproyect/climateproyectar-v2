
(() => {
  "use strict";
  function ready(fn){ if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", fn, {once:true}); else fn(); }
  function installMenu(){
    const btn=document.querySelector(".menu-toggle");
    const nav=document.getElementById("main-nav");
    if(!btn||!nav) return;
    btn.addEventListener("click",()=>{
      const open=!nav.classList.contains("open");
      nav.classList.toggle("open",open);
      btn.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click",(event)=>{ if(event.target.closest("a")){ nav.classList.remove("open"); btn.setAttribute("aria-expanded","false"); } });
  }
  function makeDraggable(scroller){
    if(!scroller || scroller.dataset.dragScrollInstalled) return;
    scroller.dataset.dragScrollInstalled="true";
    let down=false,startX=0,startLeft=0,moved=false;
    scroller.addEventListener("pointerdown",(event)=>{
      if(event.button!==undefined && event.button!==0) return;
      down=true;moved=false;startX=event.clientX;startLeft=scroller.scrollLeft;scroller.classList.add("dragging");
      try{ scroller.setPointerCapture(event.pointerId); }catch{}
    });
    scroller.addEventListener("pointermove",(event)=>{
      if(!down) return;
      const dx=event.clientX-startX;
      if(Math.abs(dx)>4) moved=true;
      scroller.scrollLeft=startLeft-dx;
    });
    function stop(){down=false;scroller.classList.remove("dragging");}
    scroller.addEventListener("pointerup",stop);
    scroller.addEventListener("pointercancel",stop);
    scroller.addEventListener("click",(event)=>{ if(moved){ event.preventDefault(); event.stopPropagation(); moved=false; } }, true);
  }
  function installDrag(){
    document.querySelectorAll(".forecast-grid,.mini-forecast-grid,#alerts-list,.alert-map-explainer,.source-grid,.metrics-grid").forEach(makeDraggable);
    const observer=new MutationObserver(()=>document.querySelectorAll(".forecast-grid,.mini-forecast-grid,#alerts-list,.alert-map-explainer,.source-grid,.metrics-grid").forEach(makeDraggable));
    observer.observe(document.body,{childList:true,subtree:true});
  }
  ready(()=>{installMenu();installDrag();});
})();
