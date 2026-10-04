import base64
import io
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
from PIL import Image, ImageDraw
from server.ocr_service.main import verify_screenshot, VerifyRequest

def create_mock_receipt(text_lines, size=(450, 300), bg=(255, 255, 255)):
    img = Image.new("RGB", size, color=bg)
    draw = ImageDraw.Draw(img)
    y = 25
    for line, color in text_lines:
        draw.text((25, y), line, fill=color)
        y += 40
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"

def run_tests():
    print("==================================================")
    print("RUNNING PAYMENT SCREENSHOT OCR TEST SUITE")
    print("==================================================")
    
    passed = 0
    total = 0

    # 1. Google Pay Screenshot
    total += 1
    gpay_img = create_mock_receipt([
        ("Google Pay", (50, 50, 200)),
        ("Paid to Nihar Shah", (20, 20, 20)),
        ("Rs 500.00", (0, 0, 0)),
        ("Payment Successful", (20, 160, 40)),
        ("UPI Ref No: 428190123456", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=gpay_img, expectedAmount=500))
    print(f"Test 1 [Google Pay]: Status={res['status']} | App={res['data']['payment_app']} | UTR={res['data']['utr']}")
    assert res["status"] == "ACCEPT", f"Expected ACCEPT, got {res['status']}"
    assert res["data"]["payment_app"] == "Google Pay"
    assert res["data"]["amount"] == 500.0
    assert res["data"]["utr"] == "428190123456"
    passed += 1

    # 2. PhonePe Screenshot
    total += 1
    phonepe_img = create_mock_receipt([
        ("PhonePe", (100, 30, 180)),
        ("Transfer Details", (30, 30, 30)),
        ("Paid to NIHAR KETAN SHAH", (20, 20, 20)),
        ("Amount: Rs 700.00", (0, 0, 0)),
        ("Transaction Successful", (20, 160, 40)),
        ("Txn ID: T24090123456789012345678", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=phonepe_img, expectedAmount=700))
    print(f"Test 2 [PhonePe]: Status={res['status']} | App={res['data']['payment_app']} | UTR={res['data']['utr']}")
    assert res["status"] == "ACCEPT"
    assert res["data"]["payment_app"] == "PhonePe"
    assert res["data"]["amount"] == 700.0
    passed += 1

    # 3. PayZapp (New App Detection)
    total += 1
    payzapp_img = create_mock_receipt([
        ("HDFC PayZapp", (0, 70, 150)),
        ("Paid to Nihar Shah", (20, 20, 20)),
        ("Amount: Rs 500.00", (0, 0, 0)),
        ("Payment Successful", (20, 160, 40)),
        ("UPI Ref: 987654321098", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=payzapp_img, expectedAmount=500))
    print(f"Test 3 [PayZapp]: Status={res['status']} | App={res['data']['payment_app']}")
    assert res["status"] == "ACCEPT"
    assert res["data"]["payment_app"] == "PayZapp"
    passed += 1

    # 4. Pop UPI / POPclub (New App Detection)
    total += 1
    popupi_img = create_mock_receipt([
        ("Pop UPI Payment", (200, 40, 100)),
        ("Money Sent to Nihar", (20, 20, 20)),
        ("Amount Rs 250.00", (0, 0, 0)),
        ("Transaction Successful", (20, 160, 40)),
        ("UPI Ref No 112233445566", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=popupi_img, expectedAmount=250))
    print(f"Test 4 [Pop UPI]: Status={res['status']} | App={res['data']['payment_app']}")
    assert res["status"] == "ACCEPT"
    assert res["data"]["payment_app"] == "Pop UPI"
    passed += 1

    # 5. Amazon Pay (New App Detection)
    total += 1
    amazon_img = create_mock_receipt([
        ("Amazon Pay", (230, 140, 30)),
        ("Paid to Nihar Shah", (20, 20, 20)),
        ("Rs 300.00", (0, 0, 0)),
        ("Payment Completed", (20, 160, 40)),
        ("UPI Ref: 556677889900", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=amazon_img, expectedAmount=300))
    print(f"Test 5 [Amazon Pay]: Status={res['status']} | App={res['data']['payment_app']}")
    assert res["status"] == "ACCEPT"
    assert res["data"]["payment_app"] == "Amazon Pay"
    passed += 1

    # 6. Manual Review Condition 1 Turned to Success: UTR missing
    total += 1
    missing_utr_img = create_mock_receipt([
        ("Google Pay", (50, 50, 200)),
        ("Paid to Nihar Shah", (20, 20, 20)),
        ("Rs 500.00", (0, 0, 0)),
        ("Payment Successful", (20, 160, 40)),
        # Note: No UTR number line
    ])
    res = verify_screenshot(VerifyRequest(image=missing_utr_img, expectedAmount=500))
    print(f"Test 6 [Missing UTR -> Success]: Status={res['status']} | UTR='{res['data']['utr']}'")
    assert res["status"] == "ACCEPT", f"Expected ACCEPT, got {res['status']}"
    passed += 1

    # 7. Manual Review Condition 2 Turned to Success: Payment processing / pending at bank
    total += 1
    pending_img = create_mock_receipt([
        ("PhonePe", (100, 30, 180)),
        ("Paid to Nihar Shah", (20, 20, 20)),
        ("Rs 500.00", (0, 0, 0)),
        ("Payment Processing at Bank", (200, 140, 20)),
        ("UTR: 334455667788", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=pending_img, expectedAmount=500))
    print(f"Test 7 [Pending at Bank -> Success]: Status={res['status']}")
    assert res["status"] == "ACCEPT", f"Expected ACCEPT, got {res['status']}"
    passed += 1

    # 8. Negative Test: Wrong Amount (Expected 500, Paid 50)
    total += 1
    wrong_amount_img = create_mock_receipt([
        ("Google Pay", (50, 50, 200)),
        ("Paid to Nihar Shah", (20, 20, 20)),
        ("Rs 50.00", (0, 0, 0)),
        ("Payment Successful", (20, 160, 40)),
        ("UPI Ref No: 428190123456", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=wrong_amount_img, expectedAmount=500))
    print(f"Test 8 [Wrong Amount]: Status={res['status']} | Reason={res['reason'][:40]}...")
    assert res["status"] == "REJECT", f"Expected REJECT, got {res['status']}"
    passed += 1

    # 9. Negative Test: Payment Failed
    total += 1
    failed_img = create_mock_receipt([
        ("Google Pay", (50, 50, 200)),
        ("To Nihar Shah", (20, 20, 20)),
        ("Rs 500.00", (0, 0, 0)),
        ("Payment Failed - Bank Declined", (200, 20, 20)),
    ])
    res = verify_screenshot(VerifyRequest(image=failed_img, expectedAmount=500))
    print(f"Test 9 [Payment Failed]: Status={res['status']}")
    assert res["status"] == "REJECT", f"Expected REJECT, got {res['status']}"
    passed += 1

    # 10. Negative Test: Random Non-Payment Picture
    total += 1
    random_img = create_mock_receipt([
        ("Chanasma Tournament News", (0, 0, 0)),
        ("Match scheduled for Sunday", (50, 50, 50)),
        ("Good luck to all players", (100, 100, 100)),
    ])
    res = verify_screenshot(VerifyRequest(image=random_img, expectedAmount=500))
    print(f"Test 10 [Random Image]: Status={res['status']}")
    assert res["status"] == "REJECT", f"Expected REJECT, got {res['status']}"
    passed += 1

    print("==================================================")
    print(f"ALL {passed}/{total} TESTS PASSED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
