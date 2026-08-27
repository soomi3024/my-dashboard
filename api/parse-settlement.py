from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import io
import re
import pandas as pd
import msoffcrypto

app = FastAPI()

def norm(v):
    return re.sub(r"\s+", "", str(v or "")).replace("(", "").replace(")", "").lower()

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
    if pd.isna(dt):
        m = re.search(r"(20\d{2})[./-](\d{1,2})[./-](\d{1,2})", str(v))
        if not m:
            return ""
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return dt.strftime("%Y-%m-%d")

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

def build_headers(raw_df: pd.DataFrame):
    header_rows = min(6, len(raw_df))
    headers = []
    for c in raw_df.columns:
        parts = []
        for r in range(header_rows):
            v = raw_df.iloc[r, c]
            if v is not None and not (isinstance(v, float) and pd.isna(v)):
                parts.append(str(v))
        headers.append(" ".join(parts))
    return headers

def find_cols(headers, group_keywords, sub_keywords=()):
    matches = []
    for i, h in enumerate(headers):
        nh = norm(h)
        if all(k in nh for k in group_keywords):
            score = sum(10 for k in sub_keywords if k in nh)
            matches.append((score, i))
    matches.sort(reverse=True)
    return [i for _, i in matches]

def parse_baemin(stream: io.BytesIO):
    raw = pd.read_excel(stream, header=None, dtype=object)
    if raw.empty or len(raw) < 4:
        raise ValueError("배민 정산 파일 구조를 읽지 못했습니다.")
    headers = build_headers(raw)
    date_cols = find_cols(headers, ["입금일"])
    # 배민 파일 형식에 따라 병합 셀/헤더 인식 방식이 달라질 수 있어
    # 첫 번째 열을 날짜 열 후보로 안전하게 사용한다.
    if not date_cols:
        for c in range(min(5, raw.shape[1])):
            values = [date_only(raw.iloc[r, c]) for r in range(min(10, len(raw)))]
            if sum(bool(x) for x in values) >= 1:
                date_cols = [c]
                break
    if not date_cols:
        raise ValueError("입금일 열을 찾지 못했습니다.")
    date_col = date_cols[0]
    deposit_cols = find_cols(headers, ["입금금액"]) or find_cols(headers, ["입금", "금액"])
    if not deposit_cols:
        raise ValueError("최종 입금금액 열을 찾지 못했습니다.")
    deposit_col = deposit_cols[-1]
    sales_cols = find_cols(headers, ["주문금액"], ["합계"]) or find_cols(headers, ["주문금액"])
    if not sales_cols:
        raise ValueError("주문금액 열을 찾지 못했습니다.")
    sales_col = sales_cols[0]
    brokerage_cols = find_cols(headers, ["중개이용료"], ["합계"]) or find_cols(headers, ["중개이용료"])
    discount_cols = find_cols(headers, ["고객할인비용"], ["합계"]) or find_cols(headers, ["고객할인비용"])
    delivery_cols = find_cols(headers, ["배달비"], ["합계"]) or find_cols(headers, ["배달비"])
    payment_cols = find_cols(headers, ["결제대행수수료"], ["합계"]) or find_cols(headers, ["결제대행수수료"])
    vat_cols = find_cols(headers, ["부가세"], ["합계"]) or find_cols(headers, ["부가세"])
    instant_cols = find_cols(headers, ["즉시할인"], ["합계"]) or find_cols(headers, ["즉시할인"])
    ad_cols = find_cols(headers, ["광고비"], ["합계"]) or find_cols(headers, ["광고비"])
    def group_value(row, cols):
        return sum(to_num(row.iloc[c]) for c in cols) if cols else 0.0
    groups = {}
    for r in range(3, len(raw)):
        date = date_only(raw.iloc[r, date_col])
        if not date:
            continue
        row = raw.iloc[r]
        sales = to_num(row.iloc[sales_col])
        deposit = to_num(row.iloc[deposit_col])
        if sales == 0 and deposit == 0:
            continue
        item = {
            "deposit_date": date,
            "channel": "배달의민족",
            "sales_amount": sales,
            "brokerage_fee": group_value(row, brokerage_cols),
            "delivery_fee": group_value(row, delivery_cols),
            "coupon_discount": group_value(row, discount_cols),
            "instant_discount": group_value(row, instant_cols),
            "advertising_fee": group_value(row, ad_cols),
            "payment_fee": group_value(row, payment_cols),
            "vat": group_value(row, vat_cols),
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
