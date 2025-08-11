import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path


def setup_logging(app, config) -> None:
    """
    Logging using config class.
    Sets up log handler for flask server, and potentially other log components.
    
    Parameters
    ----------
        app: Flask application instance
        config: Configuration class
    """
    
    # Ensure log directory exists
    log_dir = Path(config.LOG_DIR)
    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Main application log
    app_handler = RotatingFileHandler(
        filename=log_dir / 'stream_server.log',
        maxBytes=config.LOG_MAX_BYTES,
        backupCount=config.LOG_BACKUP_COUNT,
        encoding='utf-8'
    )
    app_handler.setLevel(getattr(logging, config.LOG_LEVEL))
    app_handler.setFormatter(formatter)

    app.logger.handlers.clear()
    app.logger.addHandler(app_handler)
    app.logger.setLevel(getattr(logging, config.LOG_LEVEL))
    
    # Setup specialized loggers (but they all use the same simple interface)
    _setup_component_loggers(log_dir, config, formatter)
    
    app.logger.info("="*50)
    app.logger.info(f"Stream Receiver starting - Environment: {os.getenv('FLASK_ENV', 'development')}")
    app.logger.info(f"Log level: {config.LOG_LEVEL}")
    app.logger.info("="*50)


def _setup_component_loggers(log_dir, config, formatter):
    """
    Creates log handlers for 2 different components:
        Redis handler, and image recv/broadcast componentry    

    TODO
    ----
        Access the config obj and set appropriate levels
    """
    
    # Redis logger
    redis_logger = logging.getLogger('redis')
    redis_handler = RotatingFileHandler(
        filename=log_dir / 'redis.log',
        maxBytes=config.LOG_MAX_BYTES,
        backupCount=3,
        encoding='utf-8'
    )
    redis_handler.setFormatter(formatter)
    redis_logger.addHandler(redis_handler)
    redis_logger.setLevel(logging.INFO)
    
    # Streaming logger  
    streaming_logger = logging.getLogger('streaming')
    streaming_handler = RotatingFileHandler(
        filename=log_dir / 'streaming.log',
        maxBytes=config.LOG_MAX_BYTES,
        backupCount=3,
        encoding='utf-8'
    )
    streaming_handler.setFormatter(formatter)
    streaming_logger.addHandler(streaming_handler)
    streaming_logger.setLevel(logging.INFO)


def get_logger(name='app'):
    """
    Get a logger for any component.
    
    Example
    -------
        logger = get_logger('redis')     # logs to redis.log
        logger = get_logger('streaming') # logs to streaming.log
        logger = get_logger()            # logs to main app log

    """
    return logging.getLogger(name)


# Convenience loggers (pre-configured for common use cases)
app_logger = logging.getLogger('app')
redis_logger = logging.getLogger('redis') 
streaming_logger = logging.getLogger('streaming')