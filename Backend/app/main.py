from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.extract import router as extract_router
from app.api.policy import router as policy_router
from app.api.submission import router as submission_router
from app.api.explain import router as explain_router

app = FastAPI(title="AI-Assisted Expense Submission (HITL)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/")
def root():
    return {"status": "ok", "message": "Backend running. Visit /docs for API."}


app.include_router(extract_router, prefix="/api", tags=["extract"])
app.include_router(policy_router, prefix="/api", tags=["policy"])
app.include_router(submission_router, prefix="/api", tags=["submission"])
app.include_router(explain_router, prefix="/api", tags=["explain"])