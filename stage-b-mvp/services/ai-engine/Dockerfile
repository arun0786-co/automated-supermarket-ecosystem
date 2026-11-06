FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --uid 1000 --no-create-home app && mkdir -p /data && chown app /data
USER 1000
# one worker: the model learns in memory, and a second worker would learn separately
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
