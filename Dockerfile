FROM python:3.9-slim

WORKDIR /app

# No requirements needed
# COPY requirements.txt .
# RUN pip install ...

COPY weather_service.py .

EXPOSE 5000
CMD ["python3", "-u", "weather_service.py"]
