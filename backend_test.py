#!/usr/bin/env python3
"""
Backend Production API Testing for MMC-MMS
Testing production backend at https://mmc-mms.com

Based on the Arabic request:
1) Smoke test on health endpoints
2) Test PIN validation specifically 
3) Verify responses are not MOCK
4) Document all results
5) Check if backend is properly connected to frontend
"""

import requests
import json
import time
from datetime import datetime
import sys

# Production API Base URL
BASE_URL = "https://mmc-mms.com"

# Common clinics to test
CLINICS = ['INT', 'DERM', 'xray', 'lab', 'vitals', 'ecg', 'eyes']

def print_separator(title):
    print(f"\n{'='*60}")
    print(f" {title}")
    print(f"{'='*60}")

def print_test_result(test_name, success, details=""):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status} {test_name}")
    if details:
        print(f"   {details}")

def make_request(method, url, **kwargs):
    """Make HTTP request with error handling"""
    try:
        response = requests.request(method, url, timeout=10, **kwargs)
        return response
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        return None

def test_health_endpoints():
    """Test health check endpoints"""
    print_separator("1. HEALTH ENDPOINTS SMOKE TEST")
    
    # Test main health endpoint
    print("\n🔍 Testing GET /api/v1/health")
    response = make_request('GET', f"{BASE_URL}/api/v1/health")
    if response:
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            try:
                data = response.json()
                print(f"Response: {json.dumps(data, indent=2)}")
                print_test_result("Health endpoint", True, f"Status: {data.get('status', 'unknown')}")
            except:
                print_test_result("Health endpoint", False, "Invalid JSON response")
        else:
            print_test_result("Health endpoint", False, f"HTTP {response.status_code}")
    else:
        print_test_result("Health endpoint", False, "No response")
    
    # Test alternative health endpoint
    print("\n🔍 Testing GET /api/health (if exists)")
    response = make_request('GET', f"{BASE_URL}/api/health")
    if response and response.status_code == 200:
        try:
            data = response.json()
            print(f"Response: {json.dumps(data, indent=2)}")
            print_test_result("Alternative health endpoint", True)
        except:
            print_test_result("Alternative health endpoint", False, "Invalid JSON")
    else:
        print_test_result("Alternative health endpoint", False, "Not found or error")

def test_pin_status():
    """Test PIN status endpoints"""
    print_separator("2. PIN STATUS TESTING")
    
    # Test without clinic parameter
    print("\n🔍 Testing GET /api/v1/pin/status (without clinic)")
    response = make_request('GET', f"{BASE_URL}/api/v1/pin/status")
    if response:
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            try:
                data = response.json()
                print(f"Response snippet: {json.dumps(data, indent=2)[:500]}...")
                print_test_result("PIN status (no clinic)", True, f"Found {len(data.get('pins', {}))} clinics")
                return data  # Return for further testing
            except:
                print_test_result("PIN status (no clinic)", False, "Invalid JSON")
        else:
            print_test_result("PIN status (no clinic)", False, f"HTTP {response.status_code}")
    
    # Test with specific clinic
    for clinic in CLINICS[:3]:  # Test first 3 clinics
        print(f"\n🔍 Testing GET /api/v1/pin/status?clinic={clinic}")
        response = make_request('GET', f"{BASE_URL}/api/v1/pin/status?clinic={clinic}")
        if response and response.status_code == 200:
            try:
                data = response.json()
                print(f"Clinic {clinic} PIN: {data.get('pins', {}).get(clinic, {}).get('pin', 'N/A')}")
                print_test_result(f"PIN status for {clinic}", True)
            except:
                print_test_result(f"PIN status for {clinic}", False, "Invalid JSON")
        else:
            print_test_result(f"PIN status for {clinic}", False, f"HTTP {response.status_code if response else 'No response'}")

def test_queue_status():
    """Test queue status endpoints"""
    print_separator("3. QUEUE STATUS TESTING")
    
    # Test queue status for INT clinic
    print("\n🔍 Testing GET /api/v1/queue/status?clinic=INT")
    response = make_request('GET', f"{BASE_URL}/api/v1/queue/status?clinic=INT")
    if response:
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            try:
                data = response.json()
                print(f"Response: {json.dumps(data, indent=2)}")
                print_test_result("Queue status INT", True, f"Total: {data.get('total', 0)}, Waiting: {data.get('waiting', 0)}")
            except:
                print_test_result("Queue status INT", False, "Invalid JSON")
        else:
            print_test_result("Queue status INT", False, f"HTTP {response.status_code}")

def test_queue_position():
    """Test queue position endpoint"""
    print_separator("4. QUEUE POSITION TESTING")
    
    # Test queue position
    test_user = "123456789012"
    print(f"\n🔍 Testing GET /api/v1/queue/position?clinic=INT&user={test_user}")
    response = make_request('GET', f"{BASE_URL}/api/v1/queue/position?clinic=INT&user={test_user}")
    if response:
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            try:
                data = response.json()
                print(f"Response: {json.dumps(data, indent=2)}")
                print_test_result("Queue position", True, f"Position: {data.get('position', 'N/A')}")
            except:
                print_test_result("Queue position", False, "Invalid JSON")
        elif response.status_code == 404:
            print_test_result("Queue position", True, "User not in queue (expected)")
        else:
            print_test_result("Queue position", False, f"HTTP {response.status_code}")

def test_pin_validation():
    """Test PIN validation through queue/done endpoint"""
    print_separator("5. PIN VALIDATION TESTING")
    
    # Test with invalid PIN (99)
    print("\n🔍 Testing POST /api/v1/queue/done with invalid PIN (99)")
    payload = {
        "clinic": "INT",
        "user": "123456789012",
        "pin": "99"
    }
    
    response = make_request('POST', f"{BASE_URL}/api/v1/queue/done", 
                          json=payload,
                          headers={'Content-Type': 'application/json'})
    
    if response:
        print(f"Status: {response.status_code}")
        try:
            data = response.json()
            print(f"Response: {json.dumps(data, indent=2)}")
            
            if response.status_code == 400 and 'Invalid PIN' in data.get('error', ''):
                print_test_result("PIN validation (invalid PIN)", True, "Correctly rejected invalid PIN")
            elif response.status_code == 200:
                print_test_result("PIN validation (invalid PIN)", False, "❌ CRITICAL: Invalid PIN was accepted!")
            else:
                print_test_result("PIN validation (invalid PIN)", False, f"Unexpected response: {response.status_code}")
        except:
            print_test_result("PIN validation (invalid PIN)", False, "Invalid JSON response")
    
    # Test with missing PIN
    print("\n🔍 Testing POST /api/v1/queue/done without PIN")
    payload_no_pin = {
        "clinic": "INT",
        "user": "123456789012"
    }
    
    response = make_request('POST', f"{BASE_URL}/api/v1/queue/done", 
                          json=payload_no_pin,
                          headers={'Content-Type': 'application/json'})
    
    if response:
        print(f"Status: {response.status_code}")
        try:
            data = response.json()
            print(f"Response: {json.dumps(data, indent=2)}")
            print_test_result("PIN validation (no PIN)", True, "Response received")
        except:
            print_test_result("PIN validation (no PIN)", False, "Invalid JSON")

def check_mock_vs_real():
    """Check if responses are real vs mocked"""
    print_separator("6. MOCK vs REAL DATA VERIFICATION")
    
    # Get PIN data multiple times to check for variation
    print("\n🔍 Checking if PIN data is dynamic (not mocked)")
    
    pins_data = []
    for i in range(3):
        response = make_request('GET', f"{BASE_URL}/api/v1/pin/status")
        if response and response.status_code == 200:
            try:
                data = response.json()
                pins_data.append(data)
                time.sleep(1)  # Wait between requests
            except:
                pass
    
    if len(pins_data) >= 2:
        # Check if timestamps are different
        timestamps = [data.get('timestamp') for data in pins_data if data.get('timestamp')]
        dates = [data.get('date') for data in pins_data if data.get('date')]
        
        if len(set(timestamps)) > 1:
            print_test_result("Dynamic timestamps", True, "Timestamps vary between requests")
        else:
            print_test_result("Dynamic timestamps", False, "Timestamps are static (possible mock)")
        
        # Check if date is today
        today = datetime.now().strftime('%Y-%m-%d')
        if any(date == today for date in dates):
            print_test_result("Current date", True, f"Using today's date: {today}")
        else:
            print_test_result("Current date", False, f"Not using current date. Found: {dates}")
    
    # Check queue data for realistic patterns
    print("\n🔍 Checking queue data realism")
    response = make_request('GET', f"{BASE_URL}/api/v1/queue/status?clinic=INT")
    if response and response.status_code == 200:
        try:
            data = response.json()
            queue_list = data.get('list', [])
            
            if queue_list:
                # Check for realistic patient IDs (should be varied)
                patient_ids = [item.get('patient_id') for item in queue_list if item.get('patient_id')]
                if len(set(patient_ids)) == len(patient_ids):  # All unique
                    print_test_result("Unique patient IDs", True, f"Found {len(patient_ids)} unique patients")
                else:
                    print_test_result("Unique patient IDs", False, "Duplicate patient IDs found")
            else:
                print_test_result("Queue data", True, "Empty queue (realistic)")
        except:
            print_test_result("Queue data analysis", False, "Could not analyze queue data")

def check_cors_and_headers():
    """Check CORS and headers for frontend integration"""
    print_separator("7. FRONTEND INTEGRATION CHECK")
    
    print("\n🔍 Checking CORS headers")
    response = make_request('OPTIONS', f"{BASE_URL}/api/v1/health")
    if response:
        headers = response.headers
        cors_origin = headers.get('Access-Control-Allow-Origin')
        cors_methods = headers.get('Access-Control-Allow-Methods')
        cors_headers = headers.get('Access-Control-Allow-Headers')
        
        print(f"CORS Origin: {cors_origin}")
        print(f"CORS Methods: {cors_methods}")
        print(f"CORS Headers: {cors_headers}")
        
        if cors_origin == '*':
            print_test_result("CORS configuration", True, "Allows all origins")
        else:
            print_test_result("CORS configuration", False, f"Restricted to: {cors_origin}")
    
    # Test actual API call with CORS
    print("\n🔍 Testing actual API call with CORS")
    response = make_request('GET', f"{BASE_URL}/api/v1/health", 
                          headers={'Origin': 'https://mmc-mms.com'})
    if response and response.status_code == 200:
        print_test_result("API call with Origin header", True, "Frontend can access API")
    else:
        print_test_result("API call with Origin header", False, "CORS issue detected")

def generate_curl_commands():
    """Generate curl commands for manual testing"""
    print_separator("8. CURL COMMANDS FOR MANUAL TESTING")
    
    commands = [
        f"curl -X GET '{BASE_URL}/api/v1/health'",
        f"curl -X GET '{BASE_URL}/api/v1/pin/status'",
        f"curl -X GET '{BASE_URL}/api/v1/queue/status?clinic=INT'",
        f"curl -X GET '{BASE_URL}/api/v1/queue/position?clinic=INT&user=123456789012'",
        f"curl -X POST '{BASE_URL}/api/v1/queue/done' -H 'Content-Type: application/json' -d '{{\"clinic\":\"INT\",\"user\":\"123456789012\",\"pin\":\"99\"}}'",
        f"curl -X OPTIONS '{BASE_URL}/api/v1/health'"
    ]
    
    print("\n📋 Basic curl commands for testing:")
    for i, cmd in enumerate(commands, 1):
        print(f"{i}. {cmd}")

def main():
    """Main testing function"""
    print("🚀 Starting MMC-MMS Production Backend Testing")
    print(f"Target: {BASE_URL}")
    print(f"Time: {datetime.now().isoformat()}")
    
    try:
        test_health_endpoints()
        test_pin_status()
        test_queue_status()
        test_queue_position()
        test_pin_validation()
        check_mock_vs_real()
        check_cors_and_headers()
        generate_curl_commands()
        
        print_separator("TESTING COMPLETE")
        print("✅ Backend testing completed successfully")
        print("📝 Check results above for any failed tests")
        
    except KeyboardInterrupt:
        print("\n⚠️ Testing interrupted by user")
    except Exception as e:
        print(f"\n❌ Testing failed with error: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main())