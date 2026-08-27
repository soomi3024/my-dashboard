from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import io
import re
import pandas as pd
import msoffcrypto

app = FastAPI()


def to_num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("원", "").replace("₩", "").strip()
    if not s or s in {"-", "nan", "None"}:
        return 0.0
    try:
        return float(s)
    except Exception:
        return 0.0


def date_only(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    dt = pd.to_datetime(v, errors="coerce")
    if pd.notna(dt):
        return dt.strftime("%Y-%m-%d")
    m = re.search(r"(20\d{2})[./-](\d{1,2})[./-](\d{1,2})", str(v))
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def norm(v):
    return re.sub(r"\s+", "", str(v or "")).replace("(", "").replace(")", "").lower()


def decrypt_if_needed(raw: bytes, password: str) -> io.BytesIO:
    source = io.BytesIO(raw)
    try:
        office = msoffcrypto.OfficeFile(source)
        if not office.is_encrypted():
            source.seek(0)
            return source
        if not password:
            raise ValueError("배민 엑셀 파일의 비밀번호를 입력해주세요.")
        office.load_key(password=password)
        out = io.BytesIO()
        office.decrypt(out)
        out.seek(0)
        return out
    except Exception as exc:
        name = exc.__class__.__name__
        if "InvalidKey" in name or "Key" in name:
            raise ValueError("엑셀 비밀번호가 맞지 않습니다.") from exc
        raise ValueError("배민 엑셀 파일을 복호화하지 못했습니다. 파일 형식 또는 비밀번호를 확인해주세요.") from exc


def find_column(columns, candidates):
    normalized = {norm(c): c for c in columns}
    for candidate in candidates:
        if norm(candidate) in normalized:
            return normalized[norm(candidate)]
    for c in columns:
        nc = norm(c)
        for candidate in candidates:
            if norm(candidate) in nc:
                return c
    return None


def sum_columns(df, candidates):
    cols = []
    for c in df.columns:
        nc = norm(c)
        if any(norm(x) in nc for x in candidates):
            cols.append(c)
    if not cols:
        return pd.Series(0.0, index=df.index)
    total = pd.Series(0.0, index=df.index)
    for c in cols:
        total = total + df[c].map(to_num)
    return total


def parse_baemin(stream: io.BytesIO):
    # 배민 정산명세서는 '상세' 시트의 5번째 행이 실제 컬럼명이다.
    # 현재 샘플 구조: 0~1 제목/기간, 2~4 다중 헤더, 5행부터 데이터.
    stream.seek(0)
    xls = pd.ExcelFile(stream)
    sheet = "상세" if "상세" in xls.sheet_names else xls.sheet_names[-1]
    df = pd.read_excel(xls, sheet_name=sheet, header=4, dtype=object)
    df = df.dropna(how="all")
    if df.empty:
        raise ValueError("배민 정산 파일의 상세 데이터를 찾지 못했습니다.")

    # 실제 배민 2026-05 샘플의 열 이름에 우선 대응하고, 이후 파일 변경에도 대비한다.
    date_col = find_column(df.columns, ["입금일", "지급일", "정산일"])
    deposit_col = find_column(df.columns, ["입금 금액", "입금금액", "(H) 입금금액", "최종 입금금액"])
    sales_col = find_column(df.columns, ["바로결제주문금액", "주문금액", "매출금액", "주문합계"])

    if date_col is None:
        # 마지막 fallback: 날짜 값이 가장 많은 열
        best_col, best_count = None, 0
        for c in df.columns:
            count = sum(bool(date_only(v)) for v in df[c].head(50))
            if count > best_count:
                best_col, best_count = c, count
        date_col = best_col if best_count >= 1 else None
    if deposit_col is None:
        raise ValueError("입금 금액 열을 찾지 못했습니다.")
    if sales_col is None:
        raise ValueError("주문금액 열을 찾지 못했습니다.")
    if date_col is None:
        raise ValueError("입금일 열을 찾지 못했습니다.")

    # 배민 샘플에서 실제 비용 열을 정확히 매핑한다.
    brokerage = sum_columns(df, ["중개이용료"])
    delivery = sum_columns(df, ["배달비"])
    discount = sum_columns(df, ["고객할인비용", "메뉴할인", "주문금액즉시할인"])
    payment = sum_columns(df, ["결제정산수수료", "결제대행수수료"])
    vat = sum_columns(df, ["(E)부가세", "부가세"])
    instant = sum_columns(df, ["즉시할인"])
    advertising = sum_columns(df, ["광고비", "우리가게클릭"])

    groups = {}
    for idx, row in df.iterrows():
        date = date_only(row[date_col])
        if not date:
            continue
        sales = to_num(row[sales_col])
        deposit = to_num(row[deposit_col])
        if sales == 0 and deposit == 0:
            continue
        item = {
            "deposit_date": date,
            "channel": "배달의민족",
            "sales_amount": sales,
            "brokerage_fee": float(brokerage.loc[idx]),
            "delivery_fee": float(delivery.loc[idx]),
            "coupon_discount": float(discount.loc[idx]),
            "instant_discount": float(instant.loc[idx]),
            "advertising_fee": float(advertising.loc[idx]),
            "payment_fee": float(payment.loc[idx]),
            "vat": float(vat.loc[idx]),
            "fee_adjustment": 0,
            "vat_adjustment": 0,
            "deposit_amount": deposit,
            "memo": "배달의민족 정산 자동입력",
        }
        if date not in groups:
            groups[date] = item
        else:
            for k, v in item.items():
                if k not in {"deposit_date", "channel", "memo"}:
                    groups[date][k] += v
    return [groups[k] for k in sorted(groups)]


@app.post("/")
@app.post("/api/parse-settlement")
async def parse_settlement(file: UploadFile = File(...), password: str = Form("")):
    if not file.filename:
        raise HTTPException(status_code=400, detail="파일이 없습니다.")
    raw = await file.read()
    if len(raw) > 4_000_000:
        raise HTTPException(status_code=413, detail="파일이 너무 큽니다. 4MB 이하 파일을 사용해주세요.")
    try:
        stream = decrypt_if_needed(raw, password)
        rows = parse_baemin(stream)
        return JSONResponse({"rows": rows})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="정산 파일 분석 중 오류가 발생했습니다.") from exc
