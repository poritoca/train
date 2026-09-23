'use strict';
// Foreground decoration only. It never requests permission or changes alert timing.
(() => {
  const overlay=document.createElement('div');overlay.id='arrivalLight';overlay.hidden=true;overlay.setAttribute('aria-hidden','true');
  overlay.innerHTML='<div class="arrival-orbit"><i></i><i></i><i></i><b></b></div><div class="arrival-caption"><strong></strong><span></span></div>';
  document.body.append(overlay);let timer=0,frame=0;
  function clear(){clearTimeout(timer);cancelAnimationFrame(frame);overlay.hidden=true;overlay.classList.remove('playing')}
  function announce(title,body=''){
    clear();if(document.hidden)return;
    overlay.querySelector('strong').textContent=title;overlay.querySelector('.arrival-caption span').textContent=body;
    overlay.hidden=false;frame=requestAnimationFrame(()=>overlay.classList.add('playing'));
    timer=setTimeout(clear,7500);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clear()});window.addEventListener('pagehide',clear);
  window.EkikanEffects={announce,clear};
  document.getElementById('effectPreview')?.addEventListener('click',()=>announce('まもなく 降車駅','通知時の演出プレビュー'));
})();
