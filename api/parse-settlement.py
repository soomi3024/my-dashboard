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
    if pd.notna(dt):
        return dt.strftime("%Y-%m-%d")
    m = re.search(r"(20\d{2})[./-](\d{1,2})[./-](\d{1,2})", str(v))
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""

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
    header_rows = min(10, len(raw_df))
    headers = []
    for c in raw_df.columns:
        parts = []
        for r in range(header_rows):
            v = raw_df.iloc[r, c]
            if v is not None and not (isinstance(v, float) and pd.isna(v)):
                parts.append(str(v))
        headers.append(" ".join(parts))
    return headers

def find_cols(headers, keyword_groups, sub_keywords=()):
    matches = []
    for i, h in enumerate(headers):
        nh = norm(h)
        for group in keyword_groups:
            if all(k in nh for k in group):
                score = sum(10 for k in sub_keywords if k in nh)
                matches.append((score, i))
                break
    matches.sort(reverse=True)
    return [i for _, i in matches]

def best_date_col(raw, headers):
    cols = find_cols(headers, [["입금일"], ["지급일"], ["정산일"], ["입금", "일자"], ["지급", "일자"]])
    if cols:
        return cols[0]
    # 배민 파일의 병합/다중 헤더 구조가 바뀌어도 실제 데이터에서 날짜가 많은 열을 찾는다.
    best = None
    best_count = 0
    for c in range(raw.shape[1]):
        count = sum(bool(date_only(raw.iloc[r, c])) for r in range(len(raw)))
        if count > best_count:
            best_count = count
            best = c
    if best is not None and best_count >= 2:
        return best
    return None

def best_amount_col(raw, headers, groups, fallback_keywords=()):
    cols = find_cols(headers, groups)
    if cols:
        return cols[0]
    if fallback_keywords:
        cols = find_cols(headers, [[k] for k in fallback_keywords])
        if cols:
            return cols[0]
    return None

def parse_baemin(stream: io.BytesIO):
    raw = pd.read_excel(stream, header=None, dtype=object)
    if raw.empty or len(raw) < 2:
        raise ValueError("배민 정산 파일 구조를 읽지 못했습니다.")
    headers = build_headers(raw)
    date_col = best_date_col(raw, headers)
    if date_col is None:
        raise ValueError("입금일 열을 찾지 못했습니다.")

    deposit_col = best_amount_col(
        raw, headers,
        [["입금금액"], ["입금", "금액"], ["실입금액"], ["최종", "입금"], ["정산", "금액"], ["지급", "금액"]],
        ("입금금액", "실입금액", "정산금액", "지급금액")
    )
    sales_col = best_amount_col(
        raw, headers,
        [["주문금액", "합계"], ["주문금액"], ["주문", "금액"], ["매출금액"], ["매출", "합계"]],
        ("주문금액", "매출금액", "주문합계")
    )
    if deposit_col is None:
        raise ValueError("최종 입금금액 열을 찾지 못했습니다.")
    if sales_col is None:
        raise ValueError("주문금액 열을 찾지 못했습니다.")

    brokerage_cols = find_cols(headers, [["중개이용료"]])
    discount_cols = find_cols(headers, [["고객할인비용"]])
    delivery_cols = find_cols(headers, [["배달비"]])
    payment_cols = find_cols(headers, [["결제대행수수료"], ["결제", "대행", "수수료"]])
    vat_cols = find_cols(headers, [["부가세"]])
    instant_cols = find_cols(headers, [["즉시할인"]])
    ad_cols = find_cols(headers, [["광고비"]])

    def group_value(row, cols):
        return sum(to_num(row.iloc[c]) for c in cols) if cols else 0.0

    groups = {}
    for r in range(len(raw)):
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
