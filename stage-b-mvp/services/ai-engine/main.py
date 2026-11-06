from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Literal, Optional
import os

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

from bandit import encode_context
from model import Trainer

# service D: learns what goes together from baskets (chapter 7.3.1) and which suggestion works
# in which situation from what customers actually add (chapter 7.3.2)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    trainer.save()


app = FastAPI(title="ASE-PRIME AI Engine", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# docker compose sets this, the default matches the compose service name
PRODUCT_CORE_URL = os.environ.get("PRODUCT_CORE_URL", "http://product-core:3001")

# request schema, frontend sends what's currently in the cart
class CartItem(BaseModel):
    sku: str
    name: str
    category: str
    quantity: int = 1

# chapter 7.3.2: where the customer is, what is in the cart, what time it is
class RecommendationContext(BaseModel):
    aisle: Optional[int] = None
    hour: Optional[int] = None
    cartCategories: Optional[List[str]] = Field(None, max_length=200)

class RecommendationRequest(BaseModel):
    userId: str
    cartItems: List[CartItem]
    limit: int = Field(4, ge=1, le=50)
    context: Optional[RecommendationContext] = None

class Feedback(BaseModel):
    sku: str
    # chapter 7.3.2: +1 if added to the cart, 0 if ignored
    reward: Literal[0, 1]
    context: Optional[RecommendationContext] = None

class Purchase(BaseModel):
    # only skus: nothing here can identify the customer (chapter 7.4)
    skus: List[str] = Field(max_length=500)

class Recommendation(BaseModel):
    sku: str
    name: str
    emoji: str
    category: str
    price: float
    reason: str
    score: float

# hand-written pairings. they seed the model with generated baskets until real purchases take
# over, and they supply the human-readable reason shown next to a suggestion
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

trainer = Trainer(CO_PURCHASE_MATRIX, state_path=os.environ.get("STATE_PATH"))

# how much the bandit can move an item compared with the basket model
BANDIT_WEIGHT = 0.5


def context_vector(context: Optional[RecommendationContext], cart_categories: List[str]):
    context = context or RecommendationContext()
    return encode_context(
        context.aisle,
        context.hour if context.hour is not None else datetime.now().hour,
        context.cartCategories if context.cartCategories is not None else cart_categories,
    )


def best_reason(sku: str, cart_skus: set[str]) -> str:
    """the reason from the strongest hand-written pairing, whichever item was scanned first"""
    best_score, best = 0.0, "frequently bought together"
    for cart_sku in cart_skus:
        for related, score, reason in CO_PURCHASE_MATRIX.get(cart_sku, []):
            if related == sku and score > best_score:
                best_score, best = score, reason
    return best


async def fetch_catalog() -> dict[str, dict]:
    """whole priced catalog from product-core in one request, keyed by sku"""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{PRODUCT_CORE_URL}/api/products")
            if r.status_code == 200:
                return {p["sku"]: p for p in r.json()}
    except httpx.HTTPError:
        pass
    return {}


def to_recommendation(sku: str, product: dict, reason: str, score: float) -> Recommendation:
    return Recommendation(
        sku=sku,
        name=product["name"],
        emoji=product.get("emoji", "🛒"),
        category=product["category"],
        price=float(product["price"]),
        reason=reason,
        score=round(score, 3),
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ai-engine", "stage": "B"}


@app.post("/api/recommendations", response_model=List[Recommendation])
async def get_recommendations(req: RecommendationRequest):
    cart_skus = {item.sku for item in req.cartItems}
    catalog = await fetch_catalog()
    x = context_vector(req.context, [item.category for item in req.cartItems])

    # the basket model decides what is relevant, the bandit reorders it for this situation.
    # only items the model already relates to the cart can be suggested
    related = {sku: score for sku, score in trainer.scores(cart_skus).items() if score > 0}
    ranked = sorted(
        ((sku, score + BANDIT_WEIGHT * trainer.bandit.score(sku, x)) for sku, score in related.items()),
        key=lambda pair: pair[1],
        reverse=True,
    )

    results: List[Recommendation] = []
    for sku, score in ranked:
        # skip anything product-core doesn't know about or has deactivated
        product = catalog.get(sku)
        if product:
            results.append(to_recommendation(sku, product, best_reason(sku, cart_skus), score))
        if len(results) >= req.limit:
            return results

    # not enough related items, so fill up with what is popular
    for item in TRENDING:
        product = catalog.get(item["sku"])
        if len(results) >= req.limit:
            break
        if product and item["sku"] not in cart_skus and all(r.sku != item["sku"] for r in results):
            results.append(to_recommendation(item["sku"], product, item["reason"], 0.5))
    return results


@app.get("/api/recommendations/trending", response_model=List[Recommendation])
async def trending():
    """most popular items, useful when there's no cart context"""
    catalog = await fetch_catalog()
    return [to_recommendation(i["sku"], catalog[i["sku"]], i["reason"], 0.5) for i in TRENDING if i["sku"] in catalog]


@app.get("/api/recommendations/model")
def model_status():
    """what the model learned from, so nobody mistakes generated data for real behaviour"""
    return trainer.status()


@app.post("/api/recommendations/feedback", status_code=204)
def feedback(event: Feedback):
    trainer.feedback(event.sku, context_vector(event.context, []), float(event.reward))
    return Response(status_code=204)


@app.post("/api/events/purchase", status_code=202)
def purchase(event: Purchase):
    trainer.add_purchase(event.skus)
    return {"accepted": True}
