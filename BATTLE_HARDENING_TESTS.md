# Battle Hardening Tests - LogLineOS Blueprint4

## 🎯 Test Categories

1. **Security Tests** - Injection, Authorization, Tampering
2. **Concurrency Tests** - Race conditions, Locks, Idempotency
3. **Data Integrity Tests** - Malformed input, SQL injection, XSS
4. **Resource Limits** - Large payloads, Recursion, Memory
5. **Error Handling** - Missing fields, Invalid IDs, Network failures
6. **Edge Cases** - Empty strings, Special characters, Unicode

---

## 🔐 Security Tests

### Test 1: SQL Injection Attempt (Memory Search)
**Objective**: Ensure parameterized queries prevent SQL injection
```bash
# Try to inject SQL in search query
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"search","search_query":"'; DROP TABLE ledger.universal_registry; --"}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Query should be escaped, no table dropped

### Test 2: Unauthorized Kernel Access
**Objective**: Ensure manifest whitelist is enforced
```bash
# Try to boot a non-existent kernel
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"99999999-9999-9999-9999-999999999999","input":{}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: 403 Forbidden - kernel not in manifest

### Test 3: Tampering with app_id
**Objective**: Prevent access to other apps' data
```bash
# Try to get manifest for non-existent app
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000008","input":{"action":"get_manifest","app_id":"00000000-0000-0000-0000-000000000000"}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: 404 App not found

---

## ⚡ Concurrency Tests

### Test 4: Duplicate Enrollment (Idempotency)
**Objective**: Test idempotency - same fingerprint should not create duplicates
```bash
# Enroll same app twice rapidly
for i in {1..3}; do
  aws lambda invoke --function-name loglineos-stage0-loader \
    --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000008","input":{"action":"enroll","app_name":"Duplicate Test","app_version":"1.0.0","device_fingerprint":"test-device-001","pubkey":"ed25519:test123"}}' \
    --cli-binary-format raw-in-base64-out response_$i.json &
done
wait
```
**Expected**: 3 different app_ids (no idempotency enforcement yet - document as future enhancement)

### Test 5: Concurrent Memory Writes
**Objective**: Test concurrent writes don't cause corruption
```bash
# Write 5 memories simultaneously
for i in {1..5}; do
  aws lambda invoke --function-name loglineos-stage0-loader \
    --payload "{\"action\":\"boot\",\"boot_function_id\":\"00000000-0000-4000-8000-000000000007\",\"input\":{\"action\":\"store\",\"content\":\"Concurrent memory $i\",\"tags\":[\"test\",\"concurrent\"]}}" \
    --cli-binary-format raw-in-base64-out response_mem_$i.json &
done
wait
```
**Expected**: All 5 memories stored successfully

---

## 🧪 Data Integrity Tests

### Test 6: XSS/Script Injection in Memory Content
**Objective**: Ensure dangerous content is stored safely
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"store","content":"<script>alert(\"XSS\")</script>","tags":["security","xss"]}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Content stored as-is (ledger doesn't interpret HTML)

### Test 7: Unicode and Special Characters
**Objective**: Test international characters and emojis
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"store","content":"用户偏好深色模式 🌙 café ñoño","tags":["unicode","emoji","中文"]}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: All characters preserved correctly

### Test 8: Null Bytes and Control Characters
**Objective**: Test handling of problematic characters
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"store","content":"test\u0000null\nbyte","tags":["test"]}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Handled gracefully (may strip null bytes)

---

## 📊 Resource Limits Tests

### Test 9: Large Memory Content (1MB)
**Objective**: Test handling of large payloads
```bash
# Generate 1MB of content
LARGE_CONTENT=$(python3 -c "print('A' * 1000000)")
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload "{\"action\":\"boot\",\"boot_function_id\":\"00000000-0000-4000-8000-000000000007\",\"input\":{\"action\":\"store\",\"content\":\"$LARGE_CONTENT\",\"tags\":[\"large\"]}}" \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Accept or reject with clear error (Lambda has 6MB payload limit)

### Test 10: Many Tags (100+)
**Objective**: Test array size limits
```bash
MANY_TAGS=$(python3 -c "import json; print(json.dumps([f'tag{i}' for i in range(100)]))")
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload "{\"action\":\"boot\",\"boot_function_id\":\"00000000-0000-4000-8000-000000000007\",\"input\":{\"action\":\"store\",\"content\":\"Test with many tags\",\"tags\":$MANY_TAGS}}" \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Store successfully or reject with limit error

### Test 11: Deep Search Query Results
**Objective**: Test pagination/limits on search
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"search","search_query":"memory","limit":1000}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Should cap at reasonable limit (current: 10 default, respects limit param)

---

## 🚨 Error Handling Tests

### Test 12: Missing Required Fields
**Objective**: Validate error messages are clear
```bash
# Memory store without content
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"store","tags":["test"]}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Clear error: "Missing required field: content"

### Test 13: Invalid UUID Format
**Objective**: Test UUID validation
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"invalid-uuid","input":{}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Error about invalid UUID or function not found

### Test 14: Malformed JSON
**Objective**: Test JSON parsing errors
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{action:"store"}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: JSON parse error from Lambda

---

## 🎯 Edge Cases

### Test 15: Empty String Values
**Objective**: Test empty but present fields
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"store","content":"","tags":[]}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Reject empty content or store with warning

### Test 16: Extremely Long App Name
**Objective**: Test string length limits
```bash
LONG_NAME=$(python3 -c "print('A' * 1000)")
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload "{\"action\":\"boot\",\"boot_function_id\":\"00000000-0000-4000-8000-000000000008\",\"input\":{\"action\":\"enroll\",\"app_name\":\"$LONG_NAME\",\"app_version\":\"1.0.0\",\"device_fingerprint\":\"test\",\"pubkey\":\"ed25519:test\"}}" \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Store or truncate with clear behavior

### Test 17: Null/Undefined in Optional Fields
**Objective**: Test null handling
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"store","content":"test","tags":null,"memory_type":null}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Use defaults for null values

---

## 🔬 Advanced Tests

### Test 18: Prompt with Circular Variable References
**Objective**: Test variable interpolation safety
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000006","input":{"prompt_id":"00000000-0000-4000-8000-000000000103","variables":{"user_name":"{{org_name}}","org_name":"{{user_name}}"}}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Detect circular reference or limit recursion depth

### Test 19: Memory Search with Regex Patterns
**Objective**: Test special regex characters in search
```bash
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000007","input":{"action":"search","search_query":".*[test]+(pattern)?"}}' \
  --cli-binary-format raw-in-base64-out response.json
```
**Expected**: Treat as literal string, not regex (ILIKE escaping)

### Test 20: Enrollment with Duplicate Pubkey
**Objective**: Test key uniqueness enforcement
```bash
# Enroll two apps with same pubkey
aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000008","input":{"action":"enroll","app_name":"App1","app_version":"1.0.0","device_fingerprint":"device1","pubkey":"ed25519:DUPLICATE"}}' \
  --cli-binary-format raw-in-base64-out response1.json

aws lambda invoke --function-name loglineos-stage0-loader \
  --payload '{"action":"boot","boot_function_id":"00000000-0000-4000-8000-000000000008","input":{"action":"enroll","app_name":"App2","app_version":"1.0.0","device_fingerprint":"device2","pubkey":"ed25519:DUPLICATE"}}' \
  --cli-binary-format raw-in-base64-out response2.json
```
**Expected**: Both succeed (no uniqueness constraint yet - document as enhancement)

---

## 📈 Results Template

| Test # | Category | Test Name | Status | Notes |
|--------|----------|-----------|--------|-------|
| 1 | Security | SQL Injection | ⏳ | |
| 2 | Security | Unauthorized Kernel | ⏳ | |
| 3 | Security | Tampering app_id | ⏳ | |
| 4 | Concurrency | Duplicate Enrollment | ⏳ | |
| 5 | Concurrency | Concurrent Writes | ⏳ | |
| 6 | Data Integrity | XSS Injection | ⏳ | |
| 7 | Data Integrity | Unicode/Emoji | ⏳ | |
| 8 | Data Integrity | Null Bytes | ⏳ | |
| 9 | Resource Limits | Large Payload | ⏳ | |
| 10 | Resource Limits | Many Tags | ⏳ | |
| 11 | Resource Limits | Deep Search | ⏳ | |
| 12 | Error Handling | Missing Fields | ⏳ | |
| 13 | Error Handling | Invalid UUID | ⏳ | |
| 14 | Error Handling | Malformed JSON | ⏳ | |
| 15 | Edge Cases | Empty Strings | ⏳ | |
| 16 | Edge Cases | Long Strings | ⏳ | |
| 17 | Edge Cases | Null Fields | ⏳ | |
| 18 | Advanced | Circular References | ⏳ | |
| 19 | Advanced | Regex in Search | ⏳ | |
| 20 | Advanced | Duplicate Pubkey | ⏳ | |

---

## 🎯 Priority Tests to Run First

1. **Security Tests (1-3)** - Critical for production readiness
2. **Error Handling (12-14)** - User experience and debugging
3. **Data Integrity (6-8)** - Data safety and correctness
4. **Concurrency (4-5)** - Race condition detection

Let's start with these!
