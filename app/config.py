"""
Configuration for entire app.
Includes Logging, Redis Pub/Sub, and Flask settings

"""

import os
from pathlib import Path


class Config:
    """Base configuration, all other deployment types will inherent from this"""
    
    #############################################
    # Flask Server Settings                     #
    #############################################
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    HOST = os.getenv('HOST', '0.0.0.0')
    PORT = int(os.getenv('PORT', 5000))
    DEBUG = False
    TESTING = False
    
    #############################################
    # Redis settings                            #
    #############################################
    REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
    REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
    REDIS_CHANNEL = os.getenv('REDIS_CHANNEL', 'camera_stream')
    
    #############################################
    # Logging settings                          #
    #############################################
    LOG_DIR = Path(os.getenv('LOG_DIR', 'logs/stream_receiver'))
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    LOG_MAX_BYTES = int(os.getenv('LOG_MAX_BYTES', 1024*1024*20))  # 20MB
    LOG_BACKUP_COUNT = int(os.getenv('LOG_BACKUP_COUNT', 5))
    
    #############################################
    # Fault handling                            #
    #############################################
    # FAULT_LOG_DIR = Path(os.getenv('FAULT_LOG_DIR', 'var/log/faults'))
    
    #############################################
    # Streaming settings                        #
    #############################################
    MAX_VIEWERS = int(os.getenv('MAX_VIEWERS', 50))
    FRAME_TIMEOUT = float(os.getenv('FRAME_TIMEOUT', 5.0))
    VIEWER_QUEUE_SIZE = int(os.getenv('VIEWER_QUEUE_SIZE', 2))
    
    @classmethod
    def init_directories(cls):
        """Create necessary directories."""
        cls.LOG_DIR.mkdir(parents=True, exist_ok=True)
        # cls.FAULT_LOG_DIR.mkdir(parents=True, exist_ok=True)

    def overview(self) -> None:
        """
        Prints all class variables (including inherited ones) for a given object instance.
        """
        d = dict()
        for cls in self.__class__.__mro__[::-1]:
            if cls is object: # Skip the 'object' class itself
                continue
            d.update(cls.__dict__)
        for name, value in d.items():
            # Filter out methods and special attributes
            if not callable(value) and not isinstance(value,classmethod) and not name.startswith('__') and not name.endswith('__'):
                print("{0:20}: {1}".format(name, value))
        

class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    LOG_LEVEL = 'DEBUG'
    LOG_DIR = Path(os.getenv('LOG_DIR', 'logs/stream_receiver'))


class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    LOG_LEVEL = 'INFO'
    LOG_DIR = Path(os.getenv('LOG_DIR', '/var/log/stream_receiver'))
    
    # Override with production values
    SECRET_KEY = os.getenv('SECRET_KEY')

    def __post_init__(self):
        if not self.SECRET_KEY:
            raise ValueError("SECRET_KEY environment variable must be set in production")


class TestingConfig(Config):
    """
    The testing config also enables debug settings and utilizes alternate REDIS settings

    """
    TESTING = True
    DEBUG = True
    
    REDIS_HOST = os.getenv('TEST_REDIS_HOST', 'localhost')
    REDIS_PORT = int(os.getenv('TEST_REDIS_PORT', 6380))  # NOTE NOT 6379

    LOG_LEVEL = 'ERROR'
    LOG_DIR = Path(os.getenv('LOG_DIR', 'logs/stream_receiver'))

def print_all_class_variables(obj):
    """
    Prints all class variables (including inherited ones) for a given object instance.
    """
    d = dict()
    for cls in obj.__class__.__mro__[::-1]:
        if cls is object: # Skip the 'object' class itself
            continue
        d.update(cls.__dict__)
    for name, value in d.items():
        # Filter out methods and special attributes
        if not callable(value) and not isinstance(value,classmethod) and not name.startswith('__') and not name.endswith('__'):
            print("{0:20}: {1}".format(name, value))


def get_config(config_name: str = "testing"):
    """
    Get configuration class by name.
    
    Parameters
    ----------
        config_name: str
            Name of configuration ('development', 'production', 'testing')

    Returns
    -------
        config : Config
        Configuration class instance

    """

    if not isinstance(config_name, str):
        raise TypeError(f"config_name must be string type, not: {type(config_name)}")
    
    config_name = config_name.lower()
    configs = {
        'development': DevelopmentConfig,
        'production': ProductionConfig,
        'testing': TestingConfig
    }

    config_class = configs.get(config_name, DevelopmentConfig)
    config = config_class()
    config.init_directories()
    
    return config