import base64
import io
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

try:
    from rapidocr_onnxruntime import RapidOCR
    ocr_engine = RapidOCR()
except Exception as e:
    print(f"Error initializing RapidOCR: {e}", file=sys.stderr)
    ocr_engine = None

app = FastAPI(title="Payment Screenshot OCR Validation Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VerifyRequest(BaseModel):
    image: str
    expectedAmount: Optional[float] = None

# Comprehensive UPI payment apps detection regexes
APPS_PATTERNS = [
    ("Google Pay", r"\b(google\s*pay|gpay|google\s*llc)\b"),
    ("PhonePe", r"\b(phonepe|phone\s*pe)\b"),
    ("Paytm", r"\b(paytm|paytm\s*payments\s*bank)\b"),
    ("PayZapp", r"\b(payzapp|pay\s*zapp|hdfc\s*payzapp)\b"),
    ("Pop UPI", r"\b(pop\s*upi|popclub|pop\s*club|popupi)\b"),
    ("Amazon Pay", r"\b(amazon\s*pay|amazonpay|amazon\.in)\b"),
    ("CRED", r"\b(cred|cred\s*pay|dreamplug)\b"),
    ("BHIM", r"\b(bhim|bhim\s*upi|npci)\b"),
    ("WhatsApp Pay", r"\b(whatsapp|wa\.me)\b"),
    ("Mobikwik", r"\b(mobikwik|mobi\s*kwik)\b"),
    ("Freecharge", r"\b(freecharge|free\s*charge)\b"),
    ("Airtel Thanks", r"\b(airtel\s*thanks|airtel\s*payments?\s*bank|airtel\s*money)\b"),
    ("JioPay", r"\b(jiopay|jio\s*pay|myjio)\b"),
    ("Kotak 811", r"\b(kotak|kotak\s*811|kotak\s*mahindra)\b"),
    ("SBI YONO", r"\b(sbi\s*yono|yono|state\s*bank\s*of\s*india|bhim\s*sbi)\b"),
    ("HDFC Bank", r"\b(hdfc\s*bank|hdfc)\b"),
    ("ICICI iMobile", r"\b(imobile|icici\s*bank|icici)\b"),
    ("Axis Pay", r"\b(axis\s*pay|axis\s*bank|axis)\b"),
    ("Bank of Baroda", r"\b(bob\s*world|bank\s*of\s*baroda)\b"),
    ("PNB ONE", r"\b(pnb\s*one|punjab\s*national\s*bank)\b"),
    ("Canara ai1", r"\b(canara\s*ai1|canara\s*bank)\b"),
    ("Union Bank", r"\b(vyom|union\s*bank)\b"),
    ("Federal Bank", r"\b(fedmobile|federal\s*bank)\b"),
    ("IDFC FIRST", r"\b(idfc\s*first|idfc)\b"),
    ("Jupiter", r"\b(jupiter|jupiter\s*money)\b"),
    ("Fi Money", r"\b(fi\s*money|epifi)\b"),
    ("Super.money", r"\b(super\.money|supermoney)\b"),
    ("Slice", r"\b(slice\s*pay|slice)\b"),
    ("Navi", r"\b(navi\s*upi|navi)\b"),
    ("Generic UPI", r"\b(upi\s*id|upi\s*ref|upi\s*transaction|@ok\w+|@ybl|@ibl|@axl|@paytm|@upi)\b"),
]

# Explicit failure indicators (Immediate Reject)
NEGATIVE_PATTERNS = [
    r"\b(payment\s*failed|transaction\s*failed|failed|payment\s*declined|declined|reversed|payment\s*cancelled|cancelled)\b",
]

# Payment success indicators
# Per user requirement: both successful completions AND pending/processing are treated as SUCCESS
SUCCESS_PATTERNS = [
    r"\b(payment\s*successful|paid\s*successfully|transaction\s*successful|payment\s*completed|completed|paid\s*to|money\s*sent\s*to|sent\s*successfully|successful|transfer\s*successful)\b",
    r"\b(debited\s*from|payment\s*done|bill\s*paid|transferred\s*to)\b",
    # Turned pending/processing to Success per user instructions:
    r"\b(payment\s*processing|processing|pending\s*at\s*bank|payment\s*pending|submitted\s*to\s*bank)\b",
]

UTR_PATTERNS = [
    # Explicit 12-digit UTR label
    r"(?:utr|upi\s*(?:ref|reference|transaction)?\s*(?:no|number|id|num)?)\s*[:\-#]?\s*([0-9]{12})\b",
    # PhonePe style transaction id e.g. T240...
    r"(?:transaction\s*id|txn\s*id)\s*[:\-#]?\s*(T[0-9]{18,24})\b",
    # Paytm style ref
    r"(?:upi\s*ref\s*no|ref\s*no)\s*[:\-#]?\s*([0-9]{12,18})\b",
    # General 12 consecutive digits when preceded by reference terms
    r"(?:ref|rrn|txn|id)\s*[:\-#]?\s*([0-9]{12})\b",
    # Any standalone 12 digits
    r"\b([0-9]{12})\b",
]

def clean_base64_image(image_str: str) -> bytes:
    """Strip header and decode base64 image data."""
    if "," in image_str:
        image_str = image_str.split(",", 1)[1]
    return base64.b64decode(image_str)

def extract_amounts(text: str) -> List[float]:
    """Find all potential payment amounts in OCR text."""
    amounts: List[float] = []
    
    # Matches ₹500, Rs. 500, INR 500, 500.00
    patterns = [
        r"(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{2})?)",
        r"(?:amount|paid|total|sent)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{2})?)",
        r"\b([0-9]{2,5}(?:\.[0-9]{2}))\b",
    ]
    
    for pat in patterns:
        for match in re.finditer(pat, text, re.IGNORECASE):
            val_str = match.group(1).replace(",", "").strip()
            try:
                val = float(val_str)
                if 10.0 <= val <= 100000.0:  # Realistic tournament fee range
                    amounts.append(val)
            except ValueError:
                continue

    return list(dict.fromkeys(amounts))

def find_best_utr(text: str) -> Optional[str]:
    """Extract UTR / Transaction ID from text."""
    for pat in UTR_PATTERNS:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None

def detect_app(text: str) -> str:
    """Identify which UPI app made the payment."""
    for app_name, pattern in APPS_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return app_name
    return "UPI Payment"

def has_negative_indicator(text: str) -> bool:
    """Check for explicit failure words."""
    for pat in NEGATIVE_PATTERNS:
        if re.search(pat, text, re.IGNORECASE):
            return True
    return False

def has_success_indicator(text: str) -> bool:
    """Check for success or processing-as-success keywords."""
    for pat in SUCCESS_PATTERNS:
        if re.search(pat, text, re.IGNORECASE):
            return True
    return False

@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "rapidocr_paddleocr_onnx",
        "ready": ocr_engine is not None,
    }

@app.post("/verify")
def verify_screenshot(req: VerifyRequest):
    if not ocr_engine:
        raise HTTPException(status_code=500, detail="OCR engine is not initialized")
    
    try:
        raw_bytes = clean_base64_image(req.image)
    except Exception as e:
        return {
            "status": "REJECT",
            "reason": "Invalid or corrupted image format. Please upload a valid PNG or JPEG.",
            "data": None
        }

    # Validate image dimensions & decoding
    try:
        pil_img = Image.open(io.BytesIO(raw_bytes))
        pil_img.verify()
        pil_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    except Exception:
        return {
            "status": "REJECT",
            "reason": "Corrupted image file. Please upload an intact payment screenshot.",
            "data": None
        }

    width, height = pil_img.size
    if width < 150 or height < 150:
        return {
            "status": "REJECT",
            "reason": "Image resolution is too low. Please upload a full-sized screenshot.",
            "data": None
        }

    # Run PaddleOCR inference
    np_img = np.array(pil_img)
    ocr_result, _ = ocr_engine(np_img)
    
    if not ocr_result:
        return {
            "status": "REJECT",
            "reason": "No text could be read from this image. Please upload a clear screenshot of your payment receipt.",
            "data": None
        }

    lines = [str(item[1]) for item in ocr_result]
    confidences = []
    for item in ocr_result:
        try:
            confidences.append(float(item[2]))
        except (ValueError, TypeError, IndexError):
            pass
    full_text = " \n ".join(lines)
    avg_conf = float(np.mean(confidences)) if confidences else 0.85

    # 1. Detection checks
    payment_app = detect_app(full_text)
    is_failed = has_negative_indicator(full_text)
    is_success = has_success_indicator(full_text)
    found_amounts = extract_amounts(full_text)
    utr = find_best_utr(full_text)

    # If explicit failure indicator is detected -> REJECT
    if is_failed and not ("successful" in full_text.lower() and "failed" not in full_text.lower()[:30]):
        return {
            "status": "REJECT",
            "reason": "Payment screenshot indicates transaction failed or declined. Please complete payment and upload confirmation.",
            "data": {
                "ocr_text": full_text,
                "payment_app": payment_app,
                "payment_success": False,
                "amount": found_amounts[0] if found_amounts else None,
                "expected_amount": req.expectedAmount,
                "utr": utr,
                "confidence": round(avg_conf, 2),
            }
        }

    # Verify payment indicators
    has_indicators = is_success or (payment_app != "UPI Payment") or bool(utr)
    if not has_indicators:
        return {
            "status": "REJECT",
            "reason": "Image does not appear to be a UPI payment receipt. Please upload a payment confirmation screenshot.",
            "data": {
                "ocr_text": full_text,
                "payment_app": payment_app,
                "payment_success": False,
                "amount": None,
                "expected_amount": req.expectedAmount,
                "utr": None,
                "confidence": round(avg_conf, 2),
            }
        }

    # 2. Amount verification
    matched_amount = None
    if req.expectedAmount is not None and req.expectedAmount > 0:
        expected = float(req.expectedAmount)
        # Check if expected amount matches any found amount
        matches = [amt for amt in found_amounts if abs(amt - expected) < 0.01 or abs(amt - expected) == 0]
        
        if matches:
            matched_amount = matches[0]
        elif found_amounts:
            # Found amounts, but none match expected
            detected_str = ", ".join(f"₹{a:.0f}" if a.is_integer() else f"₹{a:.2f}" for a in found_amounts[:3])
            expected_str = f"₹{expected:.0f}" if expected.is_integer() else f"₹{expected:.2f}"
            return {
                "status": "REJECT",
                "reason": f"Amount mismatch: Found {detected_str}, but expected {expected_str}. Please upload the screenshot showing the full required amount.",
                "data": {
                    "ocr_text": full_text,
                    "payment_app": payment_app,
                    "payment_success": is_success,
                    "amount": found_amounts[0],
                    "expected_amount": req.expectedAmount,
                    "utr": utr,
                    "confidence": round(avg_conf, 2),
                }
            }
        else:
            # Per user requirement: missing amount or unclear reading maps to SUCCESS (accept)
            matched_amount = expected
    else:
        matched_amount = found_amounts[0] if found_amounts else None

    # Per user instruction:
    # "Turn both the manual_review conditions to Success."
    # Both: 1) UTR missing / partial, and 2) Bank processing/pending -> ACCEPT (Success)!
    
    return {
        "status": "ACCEPT",
        "reason": f"Payment receipt verified successfully via {payment_app}.",
        "data": {
            "ocr_text": full_text,
            "payment_app": payment_app,
            "payment_success": True,
            "amount": matched_amount,
            "expected_amount": req.expectedAmount,
            "utr": utr or "",
            "confidence": round(avg_conf, 2),
            "checks": {
                "valid_image": True,
                "payment_indicator": True,
                "amount_match": True,
                "utr_found": bool(utr),
            }
        }
    }

if __name__ == "__main__":
    import uvicorn
    print("Starting Payment Screenshot OCR Validation Service on port 5001...")
    uvicorn.run(app, host="127.0.0.1", port=5001)
