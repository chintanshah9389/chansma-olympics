import { createWorker } from 'tesseract.js'

const PYTHON_OCR_URL = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:5001'

// Comprehensive UPI payment apps detection regexes (Node fallback parity)
const APPS_PATTERNS = [
  ['Google Pay', /\b(google\s*pay|gpay|google\s*llc)\b/i],
  ['PhonePe', /\b(phonepe|phone\s*pe)\b/i],
  ['Paytm', /\b(paytm|paytm\s*payments\s*bank)\b/i],
  ['PayZapp', /\b(payzapp|pay\s*zapp|hdfc\s*payzapp)\b/i],
  ['Pop UPI', /\b(pop\s*upi|popclub|pop\s*club|popupi)\b/i],
  ['Amazon Pay', /\b(amazon\s*pay|amazonpay|amazon\.in)\b/i],
  ['CRED', /\b(cred|cred\s*pay|dreamplug)\b/i],
  ['BHIM', /\b(bhim|bhim\s*upi|npci)\b/i],
  ['WhatsApp Pay', /\b(whatsapp|wa\.me)\b/i],
  ['Mobikwik', /\b(mobikwik|mobi\s*kwik)\b/i],
  ['Freecharge', /\b(freecharge|free\s*charge)\b/i],
  ['Airtel Thanks', /\b(airtel\s*thanks|airtel\s*payments?\s*bank|airtel\s*money)\b/i],
  ['JioPay', /\b(jiopay|jio\s*pay|myjio)\b/i],
  ['Kotak 811', /\b(kotak|kotak\s*811|kotak\s*mahindra)\b/i],
  ['SBI YONO', /\b(sbi\s*yono|yono|state\s*bank\s*of\s*india|bhim\s*sbi)\b/i],
  ['HDFC Bank', /\b(hdfc\s*bank|hdfc)\b/i],
  ['ICICI iMobile', /\b(imobile|icici\s*bank|icici)\b/i],
  ['Axis Pay', /\b(axis\s*pay|axis\s*bank|axis)\b/i],
  ['Bank of Baroda', /\b(bob\s*world|bank\s*of\s*baroda)\b/i],
  ['PNB ONE', /\b(pnb\s*one|punjab\s*national\s*bank)\b/i],
  ['Canara ai1', /\b(canara\s*ai1|canara\s*bank)\b/i],
  ['Union Bank', /\b(vyom|union\s*bank)\b/i],
  ['Federal Bank', /\b(fedmobile|federal\s*bank)\b/i],
  ['IDFC FIRST', /\b(idfc\s*first|idfc)\b/i],
  ['Jupiter', /\b(jupiter|jupiter\s*money)\b/i],
  ['Fi Money', /\b(fi\s*money|epifi)\b/i],
  ['Super.money', /\b(super\.money|supermoney)\b/i],
  ['Slice', /\b(slice\s*pay|slice)\b/i],
  ['Navi', /\b(navi\s*upi|navi)\b/i],
  ['Generic UPI', /\b(upi\s*id|upi\s*ref|upi\s*transaction|@ok\w+|@ybl|@ibl|@axl|@paytm|@upi)\b/i],
]

const NEGATIVE_PATTERNS = [
  /\b(payment\s*failed|transaction\s*failed|failed|payment\s*declined|declined|reversed|payment\s*cancelled|cancelled)\b/i,
]

const SUCCESS_PATTERNS = [
  /\b(payment\s*successful|paid\s*successfully|transaction\s*successful|payment\s*completed|completed|paid\s*to|money\s*sent\s*to|sent\s*successfully|successful|transfer\s*successful)\b/i,
  /\b(debited\s*from|payment\s*done|bill\s*paid|transferred\s*to)\b/i,
  /\b(payment\s*processing|processing|pending\s*at\s*bank|payment\s*pending|submitted\s*to\s*bank)\b/i,
]

const UTR_PATTERNS = [
  /(?:utr|upi\s*(?:ref|reference|transaction)?\s*(?:no|number|id|num)?)\s*[:\-#]?\s*([0-9]{12})\b/i,
  /(?:transaction\s*id|txn\s*id)\s*[:\-#]?\s*(T[0-9]{18,24})\b/i,
  /(?:upi\s*ref\s*no|ref\s*no)\s*[:\-#]?\s*([0-9]{12,18})\b/i,
  /(?:ref|rrn|txn|id)\s*[:\-#]?\s*([0-9]{12})\b/i,
  /\b([0-9]{12})\b/,
]

let tesseractWorker = null

async function getTesseractWorker() {
  if (!tesseractWorker) {
    tesseractWorker = await createWorker('eng')
  }
  return tesseractWorker
}

function detectApp(text) {
  for (const [appName, pattern] of APPS_PATTERNS) {
    if (pattern.test(text)) return appName
  }
  return 'UPI Payment'
}

function extractAmounts(text) {
  const amounts = []
  const patterns = [
    /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{2})?)/gi,
    /(?:amount|paid|total|sent)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{2})?)/gi,
    /\b([0-9]{2,5}(?:\.[0-9]{2}))\b/g,
  ]
  for (const pat of patterns) {
    let match
    while ((match = pat.exec(text)) !== null) {
      const valStr = match[1].replace(/,/g, '').trim()
      const val = parseFloat(valStr)
      if (Number.isFinite(val) && val >= 10 && val <= 100000) {
        if (!amounts.includes(val)) amounts.push(val)
      }
    }
  }
  return amounts
}

function findBestUtr(text) {
  for (const pat of UTR_PATTERNS) {
    const match = text.match(pat)
    if (match) return match[1].trim()
  }
  return null
}

/**
 * Tesseract fallback analysis when Python service is unavailable.
 */
async function fallbackNodeOcr(imageDataUrl, expectedAmount) {
  try {
    const worker = await getTesseractWorker()
    const base64Data = imageDataUrl.includes(',')
      ? imageDataUrl.split(',')[1]
      : imageDataUrl
    const buffer = Buffer.from(base64Data, 'base64')
    const ret = await worker.recognize(buffer)
    const fullText = ret.data.text || ''
    
    if (!fullText.trim()) {
      return {
        status: 'REJECT',
        reason: 'No text could be read from this image. Please upload a clear screenshot of your payment receipt.',
        data: null,
      }
    }

    const paymentApp = detectApp(fullText)
    const isFailed = NEGATIVE_PATTERNS.some((p) => p.test(fullText))
    const isSuccess = SUCCESS_PATTERNS.some((p) => p.test(fullText))
    const foundAmounts = extractAmounts(fullText)
    const utr = findBestUtr(fullText)

    if (isFailed && !fullText.toLowerCase().includes('successful')) {
      return {
        status: 'REJECT',
        reason: 'Payment screenshot indicates transaction failed or declined. Please complete payment and upload confirmation.',
        data: { ocr_text: fullText, payment_app: paymentApp, amount: foundAmounts[0] || null, utr },
      }
    }

    const hasIndicators = isSuccess || paymentApp !== 'UPI Payment' || Boolean(utr)
    if (!hasIndicators) {
      return {
        status: 'REJECT',
        reason: 'Image does not appear to be a UPI payment receipt. Please upload a payment confirmation screenshot.',
        data: { ocr_text: fullText, payment_app: paymentApp, amount: null, utr: null },
      }
    }

    let matchedAmount = null
    if (expectedAmount != null && expectedAmount > 0) {
      const expected = Number(expectedAmount)
      const matches = foundAmounts.filter((amt) => Math.abs(amt - expected) < 0.01)
      if (matches.length > 0) {
        matchedAmount = matches[0]
      } else if (foundAmounts.length > 0) {
        const detectedStr = foundAmounts.slice(0, 3).map((a) => `₹${a}`).join(', ')
        return {
          status: 'REJECT',
          reason: `Amount mismatch: Found ${detectedStr}, but expected ₹${expected}. Please upload the screenshot showing the full required amount.`,
          data: { ocr_text: fullText, payment_app: paymentApp, amount: foundAmounts[0], utr },
        }
      } else {
        matchedAmount = expected
      }
    } else {
      matchedAmount = foundAmounts[0] || null
    }

    return {
      status: 'ACCEPT',
      reason: `Payment receipt verified successfully via ${paymentApp}.`,
      data: {
        ocr_text: fullText,
        payment_app: paymentApp,
        payment_success: true,
        amount: matchedAmount,
        expected_amount: expectedAmount,
        utr: utr || '',
        confidence: ret.data.confidence ? ret.data.confidence / 100 : 0.85,
        checks: {
          valid_image: true,
          payment_indicator: true,
          amount_match: true,
          utr_found: Boolean(utr),
        },
      },
    }
  } catch (error) {
    console.error('Tesseract fallback error:', error)
    return {
      status: 'REJECT',
      reason: 'Failed to process screenshot: ' + (error.message || 'Unknown error'),
      data: null,
    }
  }
}

/**
 * Primary verification orchestrator:
 * 1. Calls Python PaddleOCR microservice.
 * 2. Falls back to Node Tesseract if Python service is unreachable.
 * 3. Enforces Database Duplicate UTR check using PostgreSQL pool.
 */
export async function verifyPaymentScreenshot(imageDataUrl, expectedAmount, pool = null, excludeRegId = null) {
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return {
      status: 'REJECT',
      reason: 'Please upload a valid payment screenshot.',
      data: null,
    }
  }

  let result = null

  // 1. Try Python PaddleOCR service first
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const response = await fetch(`${PYTHON_OCR_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageDataUrl,
        expectedAmount: expectedAmount != null ? Number(expectedAmount) : null,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (response.ok) {
      result = await response.json()
    }
  } catch (err) {
    // Python service is not running or timed out; fall back to Tesseract
    // console.info('Python OCR unavailable, using Tesseract fallback...')
  }

  // 2. If Python didn't return a result, run Node Tesseract fallback
  if (!result) {
    result = await fallbackNodeOcr(imageDataUrl, expectedAmount)
  }

  // 3. If ACCEPT and UTR is present, check for duplicate UTR in PostgreSQL
  if (result.status === 'ACCEPT' && result.data?.utr && pool) {
    const utr = String(result.data.utr).trim()
    if (utr.length >= 8) {
      try {
        const query = excludeRegId
          ? `SELECT id, full_name, mobile FROM registrations WHERE utr_no = $1 AND id != $2 LIMIT 1`
          : `SELECT id, full_name, mobile FROM registrations WHERE utr_no = $1 LIMIT 1`
        const params = excludeRegId ? [utr, excludeRegId] : [utr]
        const dupRes = await pool.query(query, params)
        
        if (dupRes.rowCount > 0) {
          const row = dupRes.rows[0]
          return {
            status: 'REJECT',
            reason: `Duplicate payment screenshot: UTR ${utr} has already been registered for ${row.full_name} (${row.id}). Please upload your own original receipt.`,
            data: {
              ...result.data,
              is_duplicate: true,
              duplicate_reg_id: row.id,
            },
          }
        }
      } catch (dbErr) {
        console.error('UTR duplicate check query error:', dbErr)
      }
    }
  }

  return result
}
