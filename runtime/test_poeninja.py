import base64, zlib

with open(r"G:/GameExPro3/Alith/runtime/woc_build.txt", "r") as f:
    code = f.read().strip()

b64 = code.replace("-", "+").replace("_", "/")
b64 += "=" * (4 - len(b64) % 4)
compressed = base64.b64decode(b64)
decompressed = zlib.decompress(compressed)
print("First 200 bytes:", decompressed[:200])
# POB uses XML format
print("Is XML:", decompressed[:5])
