FROM python:3.13-slim

WORKDIR /app

# сначала только список библиотек: пока он не меняется, Docker берёт установленные библиотеки из кэша,
# и после правок кода пересборка занимает секунды
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

COPY app ./app

# uvicorn принимает HTTP-запросы на порту 8000 и передаёт их приложению app из app/main.py
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
