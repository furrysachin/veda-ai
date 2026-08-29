"""
VedaAI Backend — Vercel Serverless Entry Point
Uses Vercel-compatible version with /tmp storage and synchronous processing.
"""
import sys
import os

# Add backend to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

# Import the Vercel-compatible FastAPI app
from app.main_vercel import app
