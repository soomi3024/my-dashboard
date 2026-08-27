// 월별 손익관리 - Supabase 저장/조회/그래프 연결
(function () {
  const TABLE = "monthly_profit";
  const FIELD_MAP = {
    profitLogistics: "logistics",
    profitDeliveryFee: "delivery_fee",
    profitCardFee: "card_fee",
    profitAdvertising: "advertising",
    profitGas: "gas",
    profitUtility: "utility",
    profitInsurance: "insurance",
    profitLabor: "labor",
    profitRent: "rent",
    profitTorder: "torder",
    profitPos: "pos",
    profitTaxAccountant: "tax_accountant",
    profitOtherFixed: "other_fixed",
    profitLoanInterest: "loan_interest",
    profitOther: "other",
    profitMemo: "memo"
  };

  const money = n => Number(n || 0).toLocaleString("ko-KR") + "원";
  const el = id => document.getElementById(id);

  function currentMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  function formData() {
    const data = { month: el("profitMonth")?.value || "" };
    Object.entries(FIELD_MAP).forEach(([id, column]) => {
      const node = el(id);
      if (!node) return;
      data[column] = node.type === "text" ? node.value : Number(node.value || 0);
    });
    data.royalty = Math.round(Number(window.selectedProfitSales || 0) * 0.02 * 1.1);
    return data;
  }

  function applyRow(row) {
    if (!row) return;
    Object.entries(FIELD_MAP).forEach(([id, column]) => {
      const node = el(id);
      if (node && row[column] !== undefined && row[column] !== null) node.value = row[column];
    });
    if (typeof window.calculateMonthlyProfit === "function") window.calculateMonthlyProfit();
  }

  async function loadFromSupabase() {
    const month = el("profitMonth")?.value;
    if (!month || !window.supabaseClient) return;

    try {
      const { data, error } = await window.supabaseClient
        .from(TABLE)
        .select("*")
        .eq("month", month)
        .maybeSingle();

      if (error) throw error;
      if (data) applyRow(data);
      else {
        // 저장된 값이 없는 월은 입력칸을 비우고 매출/로열티만 새로 계산
        Object.keys(FIELD_MAP).forEach(id => {
          const node = el(id);
          if (node) node.value = "";
        });
        if (typeof window.calculateMonthlyProfit === "function") window.calculateMonthlyProfit();
      }
    } catch (error) {
      console.error("monthly_profit 조회 실패", error);
      alert("월별 손익 데이터를 불러오지 못했습니다: " + error.message);
    }
  }

  async function saveToSupabase() {
    const month = el("profitMonth")?.value;
    if (!month) {
      alert("저장할 월을 먼저 선택해주세요.");
      return;
    }
    if (!window.supabaseClient) {
      alert("Supabase 연결을 확인해주세요.");
      return;
    }

    const data = formData();

    try {
      const { data: saved, error } = await window.supabaseClient
        .from(TABLE)
        .upsert(data, { onConflict: "month" })
        .select()
        .single();

      if (error) throw error;
      applyRow(saved);
      await renderProfitHistory();
      alert(month + " 손익 데이터가 Supabase에 저장되었습니다.");
    } catch (error) {
      console.error("monthly_profit 저장 실패", error);
      alert("손익 저장에 실패했습니다: " + error.message);
    }
  }

  function makeChartBox() {
    let box = el("monthlyProfitHistory");
    if (box) return box;

    const section = document.querySelector(".profit-section");
    if (!section) return null;

    box = document.createElement("div");
    box.id = "monthlyProfitHistory";
    box.style.cssText = "margin-top:24px;padding:18px;border:1px solid #e3e5e8;border-radius:12px;background:#fff;";
    box.innerHTML = `
      <h3 style="margin:0 0 12px;">월별 순이익 비교</h3>
      <div id="profitHistoryChart" style="height:260px;display:flex;align-items:flex-end;gap:8px;overflow-x:auto;padding:20px 8px 8px;background:#f8f9fa;border-radius:10px;"></div>
      <div id="profitHistoryList" style="display:grid;gap:8px;margin-top:12px;"></div>
    `;
    section.appendChild(box);
    return box;
  }

  async function renderProfitHistory() {
    if (!window.supabaseClient) return;
    const box = makeChartBox();
    if (!box) return;

    try {
      const { data, error } = await window.supabaseClient
        .from(TABLE)
        .select("*")
        .order("month", { ascending: true });
      if (error) throw error;

      const rows = data || [];
      const chart = el("profitHistoryChart");
      const list = el("profitHistoryList");
      if (!chart || !list) return;

      if (!rows.length) {
        chart.innerHTML = `<div style="width:100%;text-align:center;color:#777;">저장된 월별 손익 데이터가 없습니다.</div>`;
        list.innerHTML = "";
        return;
      }

      const values = rows.map(r => {
        const sales = Number(r.sales || 0);
        const variable = Number(r.logistics||0)+Number(r.delivery_fee||0)+Number(r.card_fee||0)+Number(r.advertising||0)+Number(r.royalty||0)+Number(r.gas||0)+Number(r.utility||0)+Number(r.insurance||0);
        const fixed = Number(r.labor||0)+Number(r.rent||0)+Number(r.torder||0)+Number(r.pos||0)+Number(r.tax_accountant||0)+Number(r.other_fixed||0);
        const financial = Number(r.loan_interest||0);
        const other = Number(r.other||0);
        const net = sales-variable-fixed-financial-other;
        return { month:r.month, sales, net };
      });

      const max = Math.max(...values.map(v => Math.abs(v.net)), 1);
      chart.innerHTML = values.map(v => {
        const height = Math.max(6, Math.round(Math.abs(v.net) / max * 180));
        const sign = v.net >= 0 ? "#4CAF50" : "#F44336";
        return `<div title="${v.month} · 순이익 ${money(v.net)}" style="min-width:58px;height:220px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px;">
          <strong style="font-size:11px;">${money(v.net)}</strong>
          <div style="width:38px;height:${height}px;background:${sign};border-radius:6px 6px 0 0;"></div>
          <span style="font-size:11px;color:#666;">${v.month}</span>
        </div>`;
      }).join("");

      list.innerHTML = [...values].reverse().map(v => `
        <div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee;">
          <strong>${v.month}</strong><strong>${money(v.net)}</strong>
        </div>
      `).join("");
    } catch (error) {
      console.error("월별 손익 그래프 실패", error);
    }
  }

  function install() {
    const month = el("profitMonth");
    const saveButton = document.querySelector('button[onclick="saveMonthlyProfit()"]');
    if (!month || !saveButton) return;

    // 기존 localStorage 저장 함수를 Supabase 저장으로 교체
    window.saveMonthlyProfit = saveToSupabase;

    if (!month.value) month.value = currentMonth();
    month.addEventListener("change", loadFromSupabase);

    // 기존 초기화가 끝난 뒤 DB 값을 다시 불러온다.
    setTimeout(async () => {
      await loadFromSupabase();
      await renderProfitHistory();
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
