import safetensors.torch as st, time, sys
print('Loading 4.7GB shard...', flush=True)
t0 = time.time()
try:
    t = st.load_file(r'E:\AIGC\Wan\Wan2.1-T2V-1.3B\transformer\diffusion_pytorch_model-00001-of-00002.safetensors')
    sz = sum(v.nbytes for v in t.values())//1024//1024
    print(f'OK in {time.time()-t0:.1f}s: {len(t)} tensors, {sz}MB', flush=True)
except Exception as e:
    print(f'ERROR: {e}', flush=True)
    import traceback; traceback.print_exc()
