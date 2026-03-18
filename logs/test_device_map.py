import os, sys, time
os.environ['HTTPS_PROXY'] = 'http://127.0.0.1:7890'
os.environ['HTTP_PROXY'] = 'http://127.0.0.1:7890'
import torch
from diffusers import WanPipeline
print('Testing device_map=auto...', flush=True)
try:
    pipe = WanPipeline.from_pretrained(
        r'E:\AIGC\Wan\Wan2.1-T2V-1.3B',
        torch_dtype=torch.bfloat16,
        device_map='auto',
    )
    print('Pipeline with device_map=auto loaded OK!', flush=True)
except Exception as e:
    print(f'ERROR: {e}', flush=True)
    import traceback; traceback.print_exc()
