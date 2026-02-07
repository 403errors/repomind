
import { gzipSync, gunzipSync } from "node:zlib";

console.log("Starting Cache Compression Test...");

// 1. Create a large sample string (mimicking file content)
console.log("1. Generating sample text...");
const sampleText = "This is a test file content. ".repeat(10000); // ~290KB
console.log(`original size: ${sampleText.length} bytes`);

// 2. Test compression
console.log("\n2. Testing Compression...");
const compressed = gzipSync(Buffer.from(sampleText));
const compressedBase64 = `gz:${compressed.toString('base64')}`;
console.log(`compressed size (base64): ${compressedBase64.length} bytes`);
const ratio = (1 - (compressedBase64.length / sampleText.length)) * 100;
console.log(`Compression Ratio: ${ratio.toFixed(2)}% reduction`);

if (compressedBase64.length >= sampleText.length) {
    console.error("FAIL: Compression did not reduce size!");
    process.exit(1);
}

// 3. Test decompression
console.log("\n3. Testing Decompression...");
try {
    const buffer = Buffer.from(compressedBase64.slice(3), 'base64');
    const decompressed = gunzipSync(buffer).toString();

    if (decompressed === sampleText) {
        console.log("PASS: Decompressed content matches original!");
    } else {
        console.error("FAIL: Content mismatch!");
        console.log("Original length:", sampleText.length);
        console.log("Decompressed length:", decompressed.length);
        process.exit(1);
    }
} catch (e) {
    console.error("FAIL: Decompression threw error:", e);
    process.exit(1);
}

// 4. Test specific edge case: invalid base64
console.log("\n4. Testing Edge Case: Invalid Base64...");
try {
    const invalid = "gz:not-base64-string";
    const buffer = Buffer.from(invalid.slice(3), 'base64');
    // gunzip might throw on bad data
    try {
        gunzipSync(buffer);
        console.warn("WARNING: gunzip did not throw on invalid data (might be empty result)");
    } catch {
        console.log("PASS: gunzip threw error as expected");
    }
} catch (e) {
    console.log("PASS: Buffer/gunzip handled error gracefully");
}

console.log("\n✅ All tests passed!");
