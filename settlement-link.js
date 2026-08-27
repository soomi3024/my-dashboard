(function(){
  function install(){
    if(document.getElementById('settlementManagerShortcut')) return;
    const dashboard=document.getElementById('dashboard') || document.querySelector('.container');
    if(!dashboard) return;
    const card=document.createElement('div');
    card.id='settlementManagerShortcut';
    card.className='section';
    card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h2 style="margin:0 0 6px">📥 정산관리</h2><div style="color:#777;font-size:13px;line-height:1.5">쿠팡이츠·배달의민족 정산 엑셀을 첨부하면 날짜별로 자동 입력합니다.</div></div><a href="/settlement-import.html" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#222;color:#fff;text-decoration:none;font-weight:700">정산관리 열기</a></div>`;
    dashboard.prepend(card);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(install,300));
  else setTimeout(install,300);
})();
