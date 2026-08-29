import os
from dotenv import load_dotenv

load_dotenv()


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

GEMINI_MODEL = os.getenv(
    "GEMINI_MODEL",
    "gemini-2.5-flash"
)

API_HOST = os.getenv(
    "API_HOST",
    "0.0.0.0"
)

API_PORT = int(
    os.getenv(
        "API_PORT",
        "5050"
    )
)

FRONTEND_URL = os.getenv(
    "FRONTEND_URL",
    "http://localhost:5173"
)