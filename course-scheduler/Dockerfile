# The course scheduler service (service/app.py): solver and checker for the portal. Build from course-scheduler/:
#   docker build -t course-scheduler:release .
#   docker save course-scheduler:release | gzip > ../deployment/image/course-scheduler.tar.gz
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-service.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-service.txt
COPY scheduler ./scheduler
COPY service ./service
RUN useradd --system --uid 10001 scheduler
USER scheduler
EXPOSE 8090
# DATABASE_URL (the course_scheduling database) and SCHEDULER_API_KEY come from the environment
CMD ["uvicorn", "service.app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "2"]
