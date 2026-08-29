// 월별 손익관리 - Supabase 저장/조회/그래프 연결
(function () {
  const TABLE = "monthly_profit";
  const SALES_TABLE = "sales";
  const SUPABASE_URL = "https://gvlfyzdswegwmmpzoabc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_Inp1yZHn3Qrqtzq1TWgUaw_AWxEgK5y";
  const FIELD_IDS = [
    "profitLogistics","profitDeliveryFee","profitCardFee","profitAdvertising",
    "profitGas","profitUtility","profitInsurance","profitLabor","profitRent",
    "profitTorder","profitPos","profitTaxAccountant","profitOtherFixed",
    "profitLoanInterest","profitOther"
  ];

  const client = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  const el = id => document.getElementById(id);
  const money = n => Number(n || 0).toLocaleString("ko-KR") + "원";
  const currentMonth = () => new Date().toISOString().slice(0, 7);
  const value = id => Number(el(id)?.value || 0);

  function getDetails() {
    const data = {};
    FIELD_IDS.forEach(id => data[id] = value(id));
    data.profitMemo = el("profitMemo")?.value || "";
    return data;
  }

  function applyDetails(data) {
    if (!data) return;
    FIELD_IDS.forEach(id => {
      const node = el(id);
      if (node) node.value = data[id] ?? 0;
    });
    const memo = el("profitMemo");
    if (memo) memo.value = data.profitMemo || "";
    if (typeof window.calculateMonthlyProfit === "function") window.calculateMonthlyProfit();
  }

  function makeRow(details, sales) {
    const logistics = valueFrom(details,"profitLogistics");
    const delivery = valueFrom(details,"profitDeliveryFee");
    const card = valueFrom(details,"profitCardFee");
    const ads = valueFrom(details,"profitAdvertising");
    const royalty = Math.round(Number(sales || 0) * 0.02 * 1.1);
    const gas = valueFrom(details,"profitGas");
    const utility = valueFrom(details,"profitUtility");
    const insurance = valueFrom(details,"profitInsurance");
    const labor = valueFrom(details,"profitLabor");
    const rent = valueFrom(details,"profitRent");
    const torder = valueFrom(details,"profitTorder");
    const pos = valueFrom(details,"profitPos");
    const accountant = valueFrom(details,"profitTaxAccountant");
    const otherFixed = valueFrom(details,"profitOtherFixed");
    const interest = valueFrom(details,"profitLoanInterest");
    const other = valueFrom(details,"profitOther");

    const variable = logistics + delivery + card + ads + royalty + gas + utility + insurance;
    const fixed = labor + rent + torder + pos + accountant + otherFixed;
    const profit = Number(sales || 0) - variable - fixed - interest - other;

    return {
      sales_amount: Number(sales || 0),
      logistics_amount: logistics,
      labor_amount: labor,
      rent_amount: rent,
      utilities_amount: gas + utility + insurance,
      ads_amount: ads,
      other_amount: delivery + card + torder + pos + accountant + otherFixed + interest + other,
      profit_amount: profit,
      profit_rate: Number(sales || 0) > 0 ? profit / Number(sales) * 100 : 0,
      memo: JSON.stringify({ __profitDetails: true, details })
    };
  }

  function valueFrom(data,id) { return Number(data?.[id] || 0); }

  async function loadFromSupabase() {
    const month = el("profitMonth")?.value;
    if (!month || !client) return;

    try {
      const { data, error } = await client.from(TABLE).select("*").eq("month", month).maybeSingle();
      if (error) throw error;

      if (data) {
        let details = null;
        try {
          const parsed = JSON.parse(data.memo || "");
          if (parsed?.__profitDetails) details = parsed.details;
        } catch (_) {}

        if (details) {
          applyDetails(details);
        } else {
          applyDetails({
            profitLogistics: data.logistics_amount || 0,
            profitLabor: data.labor_amount || 0,
            profitRent: data.rent_amount || 0,
            profitAdvertising: data.ads_amount || 0,
            profitOther: data.other_amount || 0,
            profitMemo: ""
          });
        }
      } else {
        FIELD_IDS.forEach(id => { if (el(id)) el(id).value = ""; });
        if (el("profitMemo")) el("profitMemo").value = "";
        if (typeof window.calculateMonthlyProfit === "function") window.calculateMonthlyProfit();
      }
    } catch (error) {
      console.error("monthly_profit 조회 실패", error);
      alert("월별 손익 데이터를 불러오지 못했습니다: " + error.message);
    }
  }

  async function saveToSupabase() {
    const month = el("profitMonth")?.value;
    if (!month) { alert("저장할 월을 먼저 선택해주세요."); return; }
    if (!client) { alert("Supabase 연결을 확인해주세요."); return; }

    const details = getDetails();
    if (typeof window.calculateMonthlyProfit === "function") window.calculateMonthlyProfit();
    const sales = Number(window.selectedProfitSales || 0);
    const row = makeRow(details, sales);
    const payload = { month, ...row, updated_at: new Date().toISOString() };

    try {
      const { data, error } = await client.from(TABLE).upsert(payload, { onConflict: "month" }).select().single();
      if (error) throw error;
      if (data) applyDetails(details);
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
    box.style.cssText = "margin-top:24px;padding:18px;border:1px solid #e3e5e8;border-radius:12px;background:#fff";
    box.innerHTML = `
      <h3 style="margin:0 0 12px">월별 순이익 비교</h3>
      <div id="profitHistoryChart" style="height:260px;display:flex;align-items:flex-end;gap:8px;overflow-x:auto;padding:20px 8px 8px;background:#f8f9fa;border-radius:10px"></div>
      <div id="profitHistoryList" style="display:grid;gap:8px;margin-top:12px"></div>`;
    section.appendChild(box);
    return box;
  }

  function parseDetails(row) {
    try {
      const parsed = JSON.parse(row?.memo || "");
      if (parsed?.__profitDetails && parsed.details) return parsed.details;
    } catch (_) {}
    return null;
  }

  function calculateHistoryProfit(row, sales) {
    const details = parseDetails(row);
    const actualSales = Number(sales || 0);

    if (details) {
      const logistics = valueFrom(details,"profitLogistics");
      const delivery = valueFrom(details,"profitDeliveryFee");
      const card = valueFrom(details,"profitCardFee");
      const ads = valueFrom(details,"profitAdvertising");
      const royalty = Math.round(actualSales * 0.02 * 1.1);
      const gas = valueFrom(details,"profitGas");
      const utility = valueFrom(details,"profitUtility");
      const insurance = valueFrom(details,"profitInsurance");
      const labor = valueFrom(details,"profitLabor");
      const rent = valueFrom(details,"profitRent");
      const torder = valueFrom(details,"profitTorder");
      const pos = valueFrom(details,"profitPos");
      const accountant = valueFrom(details,"profitTaxAccountant");
      const otherFixed = valueFrom(details,"profitOtherFixed");
      const interest = valueFrom(details,"profitLoanInterest");
      const other = valueFrom(details,"profitOther");
      const variable = logistics + delivery + card + ads + royalty + gas + utility + insurance;
      const fixed = labor + rent + torder + pos + accountant + otherFixed;
      return actualSales - variable - fixed - interest - other;
    }

    const royalty = Math.round(actualSales * 0.02 * 1.1);
    return actualSales
      - Number(row.logistics_amount || 0)
      - Number(row.labor_amount || 0)
      - Number(row.rent_amount || 0)
      - Number(row.utilities_amount || 0)
      - Number(row.ads_amount || 0)
      - Number(row.other_amount || 0)
      - royalty;
  }

  async function renderProfitHistory() {
    if (!client) return;
    const box = makeChartBox();
    if (!box) return;

    try {
      const [{ data: profitRows, error: profitError }, { data: salesRows, error: salesError }] = await Promise.all([
        client.from(TABLE).select("month,sales_amount,profit_amount,profit_rate,logistics_amount,labor_amount,rent_amount,utilities_amount,ads_amount,other_amount,memo").order("month", { ascending: true }),
        client.from(SALES_TABLE).select("sale_date,amount")
      ]);
      if (profitError) throw profitError;
      if (salesError) throw salesError;

      const salesByMonth = {};
      (salesRows || []).forEach(row => {
        const month = String(row.sale_date || "").slice(0, 7);
        if (!month) return;
        salesByMonth[month] = (salesByMonth[month] || 0) + Number(row.amount || 0);
      });

      const rows = (profitRows || []).map(row => {
        const hasActualSales = Object.prototype.hasOwnProperty.call(salesByMonth, row.month);
        const sales = hasActualSales ? salesByMonth[row.month] : Number(row.sales_amount || 0);
        const profit = calculateHistoryProfit(row, sales);
        const rate = sales > 0 ? profit / sales * 100 : 0;
        return { month: row.month, sales, profit, rate };
      });

      const chart = el("profitHistoryChart");
      const list = el("profitHistoryList");
      if (!chart || !list) return;

      if (!rows.length) {
        chart.innerHTML = `<div style="width:100%;text-align:center;color:#777">저장된 월별 손익 데이터가 없습니다.</div>`;
        list.innerHTML = "";
        return;
      }

      const max = Math.max(...rows.map(r => Math.abs(r.profit)), 1);
      chart.innerHTML = rows.map(r => {
        const height = Math.max(6, Math.round(Math.abs(r.profit) / max * 180));
        const color = r.profit < 0 ? "#ef4444" : "#22c55e";
        const sign = r.profit < 0 ? "손실" : "이익";
        return `<div title="${r.month} · ${sign} ${money(Math.abs(r.profit))}" style="min-width:70px;height:220px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px"><strong style="font-size:10px">${money(r.profit)}</strong><div style="width:38px;height:${height}px;background:${color};border-radius:6px 6px 0 0"></div><span style="font-size:11px;color:#666">${r.month}</span></div>`;
      }).join("");

      list.innerHTML = [...rows].reverse().map(r => {
        const sign = r.profit < 0 ? "순손실" : "순이익";
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #eee"><strong>${r.month}</strong><span>매출 ${money(r.sales)} · ${sign} <strong>${money(Math.abs(r.profit))}</strong> (${r.rate.toFixed(1)}%)</span></div>`;
      }).join("");
    } catch (error) {
      console.error("월별 손익 그래프 실패", error);
    }
  }

  function install() {
    const month = el("profitMonth");
    const saveButton = document.querySelector('button[onclick="saveMonthlyProfit()"]');
    if (!month || !saveButton) return;
    window.saveMonthlyProfit = saveToSupabase;
    if (!month.value) month.value = currentMonth();
    month.addEventListener("change", loadFromSupabase);
    setTimeout(async () => { await loadFromSupabase(); await renderProfitHistory(); }, 700);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();