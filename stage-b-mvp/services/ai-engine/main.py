from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import os
import httpx
from collections import defaultdict

# service D — AI recommendation engine
# stage A was using a simple rule-based lookup table
# this replaces it with item-based collaborative filtering using purchase history
# stage C will upgrade this to a full matrix factorisation model (SVD or ALS)

app = FastAPI(title="ASE-PRIME AI Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# docker compose sets this, the default matches the compose service name
PRODUCT_CORE_URL = os.environ.get("PRODUCT_CORE_URL", "http://product-core:3001")

# request schema — frontend sends what's currently in the cart
class CartItem(BaseModel):
    sku: str
    name: str
    category: str
    quantity: int = 1

class RecommendationRequest(BaseModel):
    userId: str
    cartItems: List[CartItem]
    limit: int = 4

class Recommendation(BaseModel):
    sku: str
    name: str
    emoji: str
    category: str
    price: float
    reason: str
    score: float

# hand-coded co-purchase matrix — just enough to make it look real for stage B
# in stage C this gets replaced by a proper SVD model trained on actual transaction data
# format: { sku: [(related_sku, score, reason), ...] }
CO_PURCHASE_MATRIX = {
    "PRD-001": [("DRY-003", 0.92, "commonly bought together"), ("PNT-001", 0.88, "popular breakfast combo"), ("PNT-005", 0.79, "users who bought bananas")],
    "PRD-002": [("DRY-003", 0.85, "apples + yogurt is a go-to snack"), ("SNK-001", 0.74, "trending pairing in your area")],
    "PRD-004": [("BVG-001", 0.91, "healthy choice combo"), ("PNT-003", 0.88, "avocado toast essential"), ("BKR-002", 0.82, "avocado toast essential")],
    "PRD-008": [("PNT-003", 0.87, "salad essentials"), ("DRY-004", 0.78, "spinach salad pairing")],
    "DRY-001": [("PNT-001", 0.95, "milk goes with cereal"), ("BKR-001", 0.88, "classic combo")],
    "DRY-002": [("PNT-006", 0.89, "almond milk + granola"), ("BVG-004", 0.82, "health aisle pairing")],
    "DRY-003": [("PNT-006", 0.91, "yogurt and granola bowl"), ("PRD-001", 0.88, "popular combo")],
    "BKR-001": [("DRY-001", 0.93, "bread and milk"), ("DRY-005", 0.85, "toast essentials"), ("PNT-007", 0.78, "peanut butter toast")],
    "BKR-003": [("DRY-003", 0.88, "breakfast set"), ("BVG-003", 0.82, "coffee and croissant")],
    "PNT-001": [("DRY-001", 0.95, "cereal and milk"), ("PRD-001", 0.88, "fruit with cereal")],
    "PNT-002": [("PNT-003", 0.96, "pasta and olive oil"), ("MTF-001", 0.91, "chicken pasta"), ("DRY-004", 0.85, "pasta carbonara set")],
    "PNT-003": [("PNT-002", 0.96, "pasta and olive oil"), ("MTF-001", 0.92, "great for cooking"), ("PRD-003", 0.80, "mediterranean set")],
    "BVG-003": [("BKR-003", 0.88, "morning coffee set"), ("SNK-001", 0.79, "coffee and chocolate")],
    "SNK-001": [("BVG-003", 0.84, "coffee and chocolate combo"), ("SNK-002", 0.78, "snack bundle")],
    "MTF-001": [("PNT-003", 0.94, "chicken needs olive oil"), ("PRD-005", 0.86, "chicken and tomato"), ("PNT-002", 0.83, "chicken pasta")],
    "MTF-002": [("PNT-003", 0.91, "salmon cooking essential"), ("PRD-003", 0.83, "salmon and citrus"), ("BVG-001", 0.77, "healthy meal pairing")],
}

# fallback recommendations when we have no cart data to work with
TRENDING = [
    {"sku": "BVG-001", "reason": "top seller this week"},
    {"sku": "SNK-001", "reason": "trending in your area"},
    {"sku": "DRY-003", "reason": "most added item today"},
    {"sku": "PRD-004", "reason": "staff pick"},
]

async def fetch_product(sku: str) -> dict | None:
    """fetch single product from product-core service"""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{PRODUCT_CORE_URL}/api/products/{sku}")
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return None

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ai-engine", "stage": "B"}

@app.post("/api/recommendations", response_model=List[Recommendation])
async def get_recommendations(req: RecommendationRequest):
    # aggregate scores from co-purchase matrix for all items in the cart
    candidate_scores: dict[str, float] = defaultdict(float)
    candidate_reasons: dict[str, str] = {}
    cart_skus = {item.sku for item in req.cartItems}

    for item in req.cartItems:
        related = CO_PURCHASE_MATRIX.get(item.sku, [])
        for related_sku, score, reason in related:
            # don't recommend things already in the cart
            if related_sku not in cart_skus:
                candidate_scores[related_sku] += score
                # keep the highest-scoring reason
                if related_sku not in candidate_reasons or score > candidate_scores[related_sku]:
                    candidate_reasons[related_sku] = reason

    # sort by score descending
    ranked = sorted(candidate_scores.items(), key=lambda x: x[1], reverse=True)

    # if we have nothing, fall back to trending
    if not ranked:
        ranked = [(item["sku"], 0.5) for item in TRENDING[:req.limit]]
        candidate_reasons = {item["sku"]: item["reason"] for item in TRENDING}

    results: List[Recommendation] = []
    for sku, score in ranked[:req.limit * 2]:  # fetch more than needed in case some 404
        product = await fetch_product(sku)
        if not product:
            continue
        results.append(Recommendation(
            sku=sku,
            name=product["name"],
            emoji=product.get("emoji", "🛒"),
            category=product["category"],
            price=float(product["price"]),
            reason=candidate_reasons.get(sku, "frequently bought together"),
            score=round(score, 3),
        ))
        if len(results) >= req.limit:
            break

    return results

@app.get("/api/recommendations/trending", response_model=List[Recommendation])
async def trending():
    """returns hardcoded trending items — useful when there's no cart context"""
    results = []
    for item in TRENDING:
        product = await fetch_product(item["sku"])
        if product:
            results.append(Recommendation(
                sku=item["sku"],
                name=product["name"],
                emoji=product.get("emoji", "🛒"),
                category=product["category"],
                price=float(product["price"]),
                reason=item["reason"],
                score=0.5,
            ))
    return results
