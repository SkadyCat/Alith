import struct, sys

path = r'E:\AIGC\Wan\Wan2.1-T2V-1.3B\transformer\diffusion_pytorch_model-00001-of-00002.safetensors'
import os
size = os.path.getsize(path)
print(f'File size: {size//1024//1024}MB ({size} bytes)', flush=True)

# Read safetensors header
with open(path, 'rb') as f:
    # First 8 bytes = header length as little-endian uint64
    hdr_len_bytes = f.read(8)
    hdr_len = struct.unpack('<Q', hdr_len_bytes)[0]
    print(f'Header length: {hdr_len} bytes', flush=True)
    if hdr_len > 100_000_000:
        print('ERROR: Header too large, file corrupted!', flush=True)
        sys.exit(1)
    hdr = f.read(hdr_len)
    import json
    meta = json.loads(hdr.decode('utf-8'))
    keys = list(meta.keys())
    print(f'Tensors: {len(keys)}, first: {keys[0]}', flush=True)
    # Check last tensor offset
    non_meta = {k:v for k,v in meta.items() if k != '__metadata__'}
    max_end = max(v['data_offsets'][1] for v in non_meta.values())
    expected_size = 8 + hdr_len + max_end
    print(f'Expected file size: {expected_size//1024//1024}MB, actual: {size//1024//1024}MB', flush=True)
    if abs(expected_size - size) < 1024:
        print('File integrity: OK', flush=True)
    else:
        print(f'File integrity: MISMATCH! diff={expected_size-size}', flush=True)
