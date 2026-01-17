FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY weather_service.py .
COPY templates/ ./templates/

EXPOSE 5000
CMD ["python", "weather_service.py"]
