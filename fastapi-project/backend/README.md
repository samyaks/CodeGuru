# FastAPI Project

A FastAPI application with proper configuration and structure.

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py
│   └── core/
│       ├── __init__.py
│       └── config.py
├── env.example
├── requirements.txt
└── README.md
```

## Features

- FastAPI application with CORS middleware
- Health check endpoint at `/health`
- Root endpoint with welcome message
- Pydantic Settings for environment variables
- Support for database, Redis, and API keys configuration
- Environment-based configuration (dev/prod)

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Copy environment file:
```bash
cp env.example .env
```

3. Update `.env` with your actual configuration values

4. Run the application:
```bash
uvicorn app.main:app --reload
```

## Endpoints

- `GET /` - Welcome message
- `GET /health` - Health check

## Configuration

The application uses Pydantic Settings for configuration management. All settings can be configured via environment variables or a `.env` file.

### Available Settings

- `ENVIRONMENT` - Application environment (dev/prod)
- `DATABASE_URL` - Database connection string
- `REDIS_URL` - Redis connection string
- `GITHUB_API_KEY` - GitHub API key
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `SECRET_KEY` - Application secret key
- `DEBUG` - Debug mode
- `HOST` - Server host
- `PORT` - Server port
