"""Checks that PyTorch in the container runs on the GPU (a real kernel, not just is_available)."""
import torch

print("torch", torch.__version__, "CUDA", torch.version.cuda, "cuDNN", torch.backends.cudnn.version())
if not torch.cuda.is_available():
    raise SystemExit("No GPU visible: is the NVIDIA runtime enabled in Docker Desktop?")
major, minor = torch.cuda.get_device_capability(0)
arch = f"sm_{major}{minor}"
print("GPU", torch.cuda.get_device_name(0), arch, "built for", " ".join(torch.cuda.get_arch_list()))
# Compiled kernels run on any GPU of the same major version with an equal or
# higher minor one: sm_60 kernels run on a GTX 1080 Ti (sm_61).
usable = [a for a in torch.cuda.get_arch_list() if a.startswith(f"sm_{major}") and int(a[len(f"sm_{major}"):]) <= minor]
if not usable:
    raise SystemExit(f"This PyTorch build has no kernels for {arch}: use a CUDA 12.x image")
print("kernels used:", usable[-1])
x = torch.randn(2048, 2048, device="cuda")
y = (x @ x).sum().item()
free, total = torch.cuda.mem_get_info()
print(f"matmul OK ({y:.1f}); GPU memory free {free / 2**30:.1f} of {total / 2**30:.1f} GB")
