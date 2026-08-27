(() => {
  const URL = "https://gvlfyzdswegwmmpzoabc.supabase.co";
  const KEY = "sb_publishable_Inp1yZHn3Qrqtzq1TWgUaw_AWxEgK5y";
  const client = window.supabase?.createClient ? window.supabase.createClient(URL, KEY) : null;
  const ids = ["profitLogistics","profitDeliveryFee","profitCardFee","profitAdvertising","profitGas","profitUtility","profitInsurance","profitLabor","profitRent","profitTorder","profitPos","profitTaxAccountant","profitOtherFixed","profitLoanInterest","profitOther"];
  const num = id => Number(document.getElementById(id)?.value || 0);
  const getMonth = () => document.getElementById("profitMonth")?.value || "";
  const getForm = () => {
    const data = {};
    ids.forEach(id => data[id] = num(id));
    data.profitMemo = document.getElementById("profitMemo")?.value || "";
    return data;
  };
  const applyForm = data => {
    if (!data) return;
    ids.forEach(id => { const el=document.getElementById(id); if(el) el.value = data[id] ?? 0; });
    const memo=document.getElementById("profitMemo"); if(memo) memo.value=data.profitMemo || "";
    if (typeof window.calculateMonthlyProfit === "function") window.calculateMonthlyProfit();
  };
  const summary = data => ({
    logistics_amount:data.profitLogistics||0,
    labor_amount:data.profitLabor||0,
    rent_amount:data.profitRent||0,
    utilities_amount:(data.profitGas||0)+(data.profitUtility||0)+(data.profitInsurance||0),
    ads_amount:data.profitAdvertising||0,
    other_amount:(data.profitDeliveryFee||0)+(data.profitCardFee||0)+(data.profitTorder||0)+(data.profitPos||0)+(data.profitTaxAccountant||0)+(data.profitOtherFixed||0)+(data.profitLoanInterest||0)+(data.profitOther||0)
  });
  async function loadDB(){
    const month=getMonth();
    if(!month || !client) return;
    const {data,error}=await client.from("monthly_profit").select("*").eq("month",month).maybeSingle();
    if(error){ console.error(error); return; }
    if(data?.details){ applyForm(data.details); return; }
    if(data){
      applyForm({profitLogistics:data.logistics_amount,profitLabor:data.labor_amount,profitRent:data.rent_amount,profitAdvertising:data.ads_amount,profitOther:data.other_amount});
    }
  }
  async function saveDB(){
    const month=getMonth();
    if(!month){ alert("저장할 월을 먼저 선택해주세요."); return; }
    if(!client){ alert("Supabase 연결을 확인해주세요."); return; }
    const data=getForm();
    if(typeof window.calculateMonthlyProfit === "function") window.calculateMonthlyProfit();
    const sales=Number(window.selectedProfitSales||0);
    const s=summary(data);
    const cost=s.logistics_amount+s.labor_amount+s.rent_amount+s.utilities_amount+s.ads_amount+s.other_amount;
    const profit=sales-cost;
    const payload={month,sales_amount:sales,...s,profit_amount:profit,profit_rate:sales?profit/sales*100:0,details:data,updated_at:new Date().toISOString()};
    const {error}=await client.from("monthly_profit").upsert(payload,{onConflict:"month"});
    if(error){ console.error(error); alert("손익 저장에 실패했습니다: "+error.message); return; }
    alert(month+" 손익 데이터가 저장되었습니다.");
    await renderHistory();
  }
  async function renderHistory(){
    if(!client) return;
    const anchor=document.querySelector(".profit-form") || document.querySelector(".profit-section");
    if(!anchor) return;
    let box=document.getElementById("monthlyProfitHistory");
    if(!box){ box=document.createElement("div"); box.id="monthlyProfitHistory"; box.style.cssText="margin-top:24px;padding:16px;background:#f8f9fa;border-radius:12px"; anchor.appendChild(box); }
    const {data,error}=await client.from("monthly_profit").select("month,sales_amount,profit_amount,profit_rate").order("month",{ascending:true});
    if(error){ box.innerHTML=""; return; }
    const rows=data||[];
    if(!rows.length){box.innerHTML="<h3>월별 손익 비교</h3><div style='color:#777'>저장된 월별 손익 데이터가 없습니다.</div>";return;}
    const max=Math.max(...rows.map(r=>Math.abs(Number(r.profit_amount||0))),1);
    box.innerHTML=`<h3 style="margin-top:0">월별 손익 비교</h3>`+rows.map(r=>{const p=Number(r.profit_amount||0);const w=Math.max(2,Math.round(Math.abs(p)/max*100));const sign=p<0?"손실":"이익";return `<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><strong>${r.month}</strong><span>${Number(r.sales_amount||0).toLocaleString()}원 · ${sign} ${Math.abs(p).toLocaleString()}원 (${Number(r.profit_rate||0).toFixed(1)}%)</span></div><div style="height:12px;background:#e5e7eb;border-radius:8px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${w}%;background:${p<0?'#ef4444':'#22c55e'};border-radius:8px"></div></div></div>`}).join("");
  }
  window.saveMonthlyProfit = saveDB;
  window.loadSavedMonthlyProfit = loadDB;
  document.addEventListener("DOMContentLoaded",()=>{
    const m=document.getElementById("profitMonth");
    if(m){ if(!m.value) m.value=new Date().toISOString().slice(0,7); m.addEventListener("change",loadDB); }
    loadDB(); renderHistory();
  });
})();