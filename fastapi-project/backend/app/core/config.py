from pydantic_settings import BaseSettings
from typing import Optional
import os

class Settings(BaseSettings):
    """Application settings using Pydantic Settings"""
    
    # Environment
    ENVIRONMENT: str = "dev"
    
    # Database
    DATABASE_URL: str = "sqlite:///./app.db"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    
    # API Keys
    GITHUB_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    
    # Application settings
    SECRET_KEY: str = "your-secret-key-here"
    DEBUG: bool = True
    
    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

# Create settings instance
settings = Settings()
