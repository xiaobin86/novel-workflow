FROM pytorch/pytorch:2.7.0-cuda12.8-cudnn9-devel
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY shared/ /app/shared/
COPY image/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY image/ .

# entrypoint：动态注入 WSL2 Blackwell PTX JIT 驱动路径（修复 sm_120 无声崩溃）
COPY image/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
