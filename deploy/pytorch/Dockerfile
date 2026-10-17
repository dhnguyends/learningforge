# PyTorch on the NVIDIA GPU, with JupyterLab, for notebooks and experiments
# next to LearningForge (the app itself does not use PyTorch).
#
# CUDA 12.6 build on purpose: the GTX 1080 Ti is a Pascal card (sm_61), which
# CUDA 13 no longer supports. Same version as the host's torch 2.14.1+cu126.
FROM pytorch/pytorch:2.14.1-cuda12.6-cudnn9-runtime

# The image's Python is the system one (PEP 668 refuses pip installs), so extra
# packages go into a virtual environment that still sees the image's PyTorch.
# `pip install` in a notebook or `docker compose exec` lands there too.
RUN apt-get update && apt-get install -y --no-install-recommends python3.12-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv --system-site-packages /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir jupyterlab==4.6.4
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /workspace
EXPOSE 8888
# No fixed token: Jupyter prints a fresh one at start (docker compose logs pytorch).
CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root", "--ServerApp.root_dir=/workspace"]
