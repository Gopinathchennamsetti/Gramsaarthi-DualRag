"""
Dashboard API — Climate & Scheme Intelligence
Includes: Auth (register/login/JWT), role-based data access
Roles: district_officer | panchayat_officer | citizen

Run: uvicorn dashboard_api:app --host 0.0.0.0 --port 8081 --reload
pip install fastapi uvicorn pandas "python-jose[cryptography]" "passlib[bcrypt]" python-multipart
"""

import json, os
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext

# ── Config ─────────────────────────────────────────────────────────────────────
OUTPUTS   = Path(os.getenv("OUTPUTS_DIR", "./outputs"))
DASHBOARD = OUTPUTS / "dashboard_core"
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-use-random-32-chars")
ALGORITHM  = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 8

app = FastAPI(title="Climate Dashboard API", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2  = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# ── In-memory user store (replace with DB in production) ──────────────────────
USERS: dict = {}

def _seed():
    for username, role, district, mandal, gp, name in [
        ("district_demo",  "district_officer",  "Nalgonda", "",             "",             "Ravi Kumar"),
        ("panchayat_demo", "panchayat_officer", "Nalgonda", "Miryalaguda",  "Ananthagiri",  "Sita Devi"),
        ("citizen_demo",   "citizen",           "Nalgonda", "Miryalaguda",  "Ananthagiri",  "Arjun"),
    ]:
        USERS[username] = {
            "password_hash": pwd_ctx.hash("demo1234"),
            "role": role, "name": name,
            "district": district, "mandal": mandal, "gp": gp,
        }
_seed()

# ── Auth models & helpers ──────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    password: str
    name:     str
    role:     str   # district_officer | panchayat_officer | citizen
    district: str = ""
    mandal:   str = ""
    gp:       str = ""

def make_token(username: str) -> str:
    exp = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": username, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)

def user_payload(username: str) -> dict:
    u = USERS[username]
    return {"username": username, "role": u["role"], "name": u["name"],
            "district": u["district"], "mandal": u["mandal"], "gp": u["gp"]}

def get_current_user(token: str = Depends(oauth2)) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username or username not in USERS:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
        return user_payload(username)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

# ── Auth endpoints ─────────────────────────────────────────────────────────────
@app.post("/api/auth/register")
def register(req: RegisterRequest):
    if req.username in USERS:
        raise HTTPException(400, "Username already exists")
    if req.role not in ("district_officer", "panchayat_officer", "citizen"):
        raise HTTPException(400, "Invalid role")
    USERS[req.username] = {
        "password_hash": pwd_ctx.hash(req.password),
        "role": req.role, "name": req.name,
        "district": req.district, "mandal": req.mandal, "gp": req.gp,
    }
    return {"access_token": make_token(req.username), "token_type": "bearer",
            "user": user_payload(req.username)}

@app.post("/api/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends()):
    u = USERS.get(form.username)
    if not u or not pwd_ctx.verify(form.password, u["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return {"access_token": make_token(form.username), "token_type": "bearer",
            "user": user_payload(form.username)}

@app.get("/api/auth/me")
def me(user=Depends(get_current_user)):
    return user

# ── Data helpers ───────────────────────────────────────────────────────────────
def load_csv(name: str) -> pd.DataFrame:
    path = OUTPUTS / name
    if not path.exists():
        raise HTTPException(404, f"{name} not found — run core modules first")
    df = pd.read_csv(path, low_memory=False)
    for col in ["District", "Mandal"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.title()
    if "GP_Name" in df.columns:
        df["GP_Name"] = df["GP_Name"].astype(str).str.strip().str.title()
    return df

def nan_safe(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records"))

def scope(df, user, gp_col="GP_Name"):
    """Restrict data to the user's assigned jurisdiction."""
    role = user["role"]
    if role == "district_officer":
        if user["district"] and "District" in df.columns:
            df = df[df["District"] == user["district"].strip().title()]
    elif role in ("panchayat_officer", "citizen"):
        if user["district"] and "District" in df.columns:
            df = df[df["District"] == user["district"].strip().title()]
        if user["mandal"] and "Mandal" in df.columns:
            df = df[df["Mandal"] == user["mandal"].strip().title()]
        if user["gp"] and gp_col in df.columns:
            df = df[df[gp_col] == user["gp"].strip().title()]
    return df

# ── Public hierarchy (used by register form — no auth needed) ─────────────────
@app.get("/api/public/districts")
def public_districts():
    df = load_csv("core_gp_priority.csv")
    return sorted(df["District"].dropna().unique().tolist())

@app.get("/api/public/mandals")
def public_mandals(district: str = Query(...)):
    df = load_csv("core_gp_priority.csv")
    sub = df[df["District"] == district.strip().title()]
    return sorted(sub["Mandal"].dropna().unique().tolist())

@app.get("/api/public/gps")
def public_gps(district: str = Query(...), mandal: str = Query(...)):
    df = load_csv("core_gp_priority.csv")
    sub = df[(df["District"] == district.strip().title()) & (df["Mandal"] == mandal.strip().title())]
    return sorted(sub["GP_Name"].dropna().unique().tolist())

# ── Hierarchy ──────────────────────────────────────────────────────────────────
@app.get("/api/hierarchy/districts")
def get_districts(user=Depends(get_current_user)):
    df = load_csv("core_gp_priority.csv")
    if user["role"] in ("district_officer", "panchayat_officer", "citizen") and user["district"]:
        return [user["district"].strip().title()]
    return sorted(df["District"].dropna().unique().tolist())

@app.get("/api/hierarchy/mandals")
def get_mandals(district: str = Query(...), user=Depends(get_current_user)):
    df = load_csv("core_gp_priority.csv")
    sub = df[df["District"] == district.strip().title()]
    if user["role"] in ("panchayat_officer", "citizen") and user["mandal"]:
        return [user["mandal"].strip().title()]
    return sorted(sub["Mandal"].dropna().unique().tolist())

@app.get("/api/hierarchy/gps")
def get_gps(district: str = Query(...), mandal: str = Query(...), user=Depends(get_current_user)):
    df = load_csv("core_gp_priority.csv")
    sub = df[(df["District"] == district.strip().title()) & (df["Mandal"] == mandal.strip().title())]
    if user["role"] in ("panchayat_officer", "citizen") and user["gp"]:
        return [user["gp"].strip().title()]
    return sorted(sub["GP_Name"].dropna().unique().tolist())

# ── /prediction ────────────────────────────────────────────────────────────────
@app.get("/api/prediction")
def get_prediction(
    district: Optional[str] = None, mandal: Optional[str] = None, gp: Optional[str] = None,
    user=Depends(get_current_user)
):
    pred  = scope(load_csv("core_mandal_climate_predictions.csv"), user, gp_col="GP_Name")
    gp_df = scope(load_csv("core_gp_priority.csv"), user)

    if district: pred  = pred[pred["District"]   == district.strip().title()]
    if district: gp_df = gp_df[gp_df["District"] == district.strip().title()]
    if mandal:   pred  = pred[pred["Mandal"]      == mandal.strip().title()]
    if mandal:   gp_df = gp_df[gp_df["Mandal"]   == mandal.strip().title()]
    if gp:       gp_df = gp_df[gp_df["GP_Name"]  == gp.strip().title()]

    if user["role"] == "citizen":
        cols = ["District","Mandal","forecast_year","forecast_month",
                "predicted_rainfall_mm","predicted_drought_flag","drought_probability_pct"]
        simple = pred[[c for c in cols if c in pred.columns]].copy()
        simple["advice"] = simple["predicted_drought_flag"].map({
            "DROUGHT":    "⚠ Likely water shortage next month. Store water, contact local panchayat.",
            "NO_DROUGHT": "✓ Rainfall expected. Plan agricultural activities accordingly.",
        }).fillna("–")
        return {"predictions": nan_safe(simple), "gp_context": []}

    gp_ctx_cols = ["District","Mandal","GP_Name","drought_risk_score","drought_flag",
                   "total_rain_mm","drought_probability","predicted_rainfall_mm","predicted_drought_flag"]
    if user["role"] == "panchayat_officer":
        extra = ["water_activities","livelihood_activities","total_estimated_cost_lakhs",
                 "sc_st_fund_share_pct","priority_score","priority_tier"]
        gp_ctx_cols += [c for c in extra if c in gp_df.columns]

    return {
        "predictions": nan_safe(pred),
        "gp_context": nan_safe(gp_df[[c for c in gp_ctx_cols if c in gp_df.columns]].drop_duplicates()) if gp else [],
    }

# ── /recommend ─────────────────────────────────────────────────────────────────
@app.get("/api/recommend")
def get_recommendations(
    district: Optional[str] = None, mandal: Optional[str] = None, gp: Optional[str] = None,
    top_k: int = Query(default=10, le=50), user=Depends(get_current_user)
):
    rec = scope(load_csv("core_scheme_recommendations.csv"), user)
    if district: rec = rec[rec["District"] == district.strip().title()]
    if mandal:   rec = rec[rec["Mandal"]   == mandal.strip().title()]
    if gp:       rec = rec[rec["GP_Name"]  == gp.strip().title()]

    if user["role"] == "citizen":
        cols = ["Scheme Name","theme","rationale","predicted_drought_flag"]
        rec = rec[[c for c in cols if c in rec.columns]].drop_duplicates(subset=["Scheme Name"]).head(top_k)
        return {"recommendations": nan_safe(rec), "total": len(rec)}

    if user["role"] in ("panchayat_officer", "district_officer"):
        cols = ["District","Mandal","GP_Name","Scheme Name","theme","sector",
                "recommendation_rank","recommendation_score","priority_tier","rationale",
                "drought_probability_pct","predicted_rainfall_mm","activity_count",
                "avg_estimated_cost","water_relevance","drought_relevance",
                "livelihood_relevance","inclusion_relevance"]
        avail = [c for c in cols if c in rec.columns]
        return {"recommendations": nan_safe(rec[avail].head(top_k)), "total": len(rec)}

    return {"recommendations": nan_safe(rec.head(top_k)), "total": len(rec)}

# ── /analysis ──────────────────────────────────────────────────────────────────
@app.get("/api/analysis")
def get_analysis(
    district: Optional[str] = None, mandal: Optional[str] = None, gp: Optional[str] = None,
    user=Depends(get_current_user)
):
    import numpy as np
    gp_df   = scope(load_csv("core_gp_priority.csv"),               user)
    pred    = scope(load_csv("core_mandal_climate_predictions.csv"), user, gp_col="GP_Name")
    monthly = scope(load_csv("core_monthly_climate_features.csv"),   user, gp_col="GP_Name")

    if district:
        d = district.strip().title()
        gp_df   = gp_df[gp_df["District"]     == d]
        pred    = pred[pred["District"]        == d]
        monthly = monthly[monthly["District"]  == d]
    if mandal:
        m = mandal.strip().title()
        gp_df   = gp_df[gp_df["Mandal"]       == m]
        pred    = pred[pred["Mandal"]          == m]
        monthly = monthly[monthly["Mandal"]    == m]
    if gp:
        gp_df = gp_df[gp_df["GP_Name"] == gp.strip().title()]

    tier_dist = gp_df["priority_tier"].value_counts().reset_index()
    tier_dist.columns = ["tier","count"]

    trend = (monthly.groupby(["Year","Month"])["total_rain_mm"].mean()
             .reset_index().sort_values(["Year","Month"]).tail(24))
    trend["label"] = trend["Year"].astype(str)+"-"+trend["Month"].astype(str).str.zfill(2)

    gp_df2 = gp_df.copy()
    gp_df2["risk_bucket"] = pd.cut(gp_df2["drought_risk_score"].fillna(0),
                                    bins=[0,25,45,70,100], labels=["Low","Medium","High","Critical"])
    risk_dist = gp_df2["risk_bucket"].value_counts().reset_index()
    risk_dist.columns = ["bucket","count"]

    top_mandals = (gp_df.groupby("Mandal")["priority_score"].mean()
                   .reset_index().sort_values("priority_score", ascending=False).head(10))

    result = {
        "tier_distribution":       nan_safe(tier_dist),
        "monthly_rainfall_trend":  nan_safe(trend),
        "risk_distribution":       nan_safe(risk_dist),
        "top_mandals_by_priority": nan_safe(top_mandals),
        "summary": {
            "total_gps":       int(len(gp_df)),
            "critical_gps":    int((gp_df["priority_tier"] == "CRITICAL").sum()),
            "drought_mandals": int((pred["predicted_drought_flag"] == "DROUGHT").sum()),
            "avg_rainfall_mm": round(float(pred["predicted_rainfall_mm"].mean()), 2) if len(pred) else 0,
        }
    }

    if user["role"] == "district_officer":
        mandal_cmp = gp_df.groupby("Mandal").agg(
            gps=("GP_Name","count"),
            critical=("priority_tier", lambda x: (x=="CRITICAL").sum()),
            avg_score=("priority_score","mean"),
            total_cost_lakhs=("total_estimated_cost_lakhs","sum"),
        ).reset_index().sort_values("avg_score", ascending=False)
        result["mandal_comparison"] = nan_safe(mandal_cmp)

    if user["role"] == "panchayat_officer":
        cols = ["GP_Name","total_activities","water_activities","livelihood_activities",
                "total_estimated_cost_lakhs","sc_st_fund_share_pct","priority_score","priority_tier"]
        avail = [c for c in cols if c in gp_df.columns]
        result["gp_activity_detail"] = nan_safe(gp_df[avail])

    return result

# ── /alerts ────────────────────────────────────────────────────────────────────
@app.get("/api/alerts")
def get_alerts(user=Depends(get_current_user)):
    pred  = scope(load_csv("core_mandal_climate_predictions.csv"), user, gp_col="GP_Name")
    gp_df = scope(load_csv("core_gp_priority.csv"), user)
    risky = pred[pred["predicted_drought_flag"] == "DROUGHT"].copy()
    merged = risky.merge(gp_df[["District","Mandal","priority_tier","priority_score"]],
                         on=["District","Mandal"], how="left")
    merged = merged.sort_values(["drought_probability_pct","priority_score"], ascending=[False,False])
    merged["alert_message"] = merged.apply(
        lambda r: f"{r['Mandal']} ({r['District']}) — drought likely ({r.get('drought_probability_pct',0):.1f}%)",
        axis=1)
    cols = ["District","Mandal","drought_probability_pct","predicted_rainfall_mm",
            "priority_tier","priority_score","alert_message"]
    avail = [c for c in cols if c in merged.columns]
    return {"alerts": nan_safe(merged[avail].head(200)), "total": len(merged)}

@app.get("/api/kpis")
def get_kpis(user=Depends(get_current_user)):
    path = DASHBOARD / "core_kpis.json"
    if not path.exists():
        raise HTTPException(404, "KPIs not found")
    with open(path) as f:
        return json.load(f)

@app.get("/api/health")
def health():
    return {"status": "healthy"}