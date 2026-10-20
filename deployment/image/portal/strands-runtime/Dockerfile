FROM python:3.12-slim
WORKDIR /app
RUN useradd --create-home --uid 10001 runtime
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
USER runtime
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD python -c "import urllib.request,os;urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000/health',headers={'X-Runtime-Key':os.environ.get('STRANDS_RUNTIME_KEY','')}),timeout=2)" || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
