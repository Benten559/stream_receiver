"""
Main entry point for video streaming application.
"""

import os
from flask import Flask
from app.api import routes
from app.core.frame_broadcaster import FrameBroadcaster
from app.utils.logging import setup_logging
from app.config import get_config


def create_app(config_name=None):
    """
    Application factory pattern.
    
    Parameters
    ----------
        config_name: Config
            Configuration to use ('development', 'production', 'testing')
        
    Returns
    -------
        Flask application instance

    """
    app = Flask(__name__)
    
    # Load configuration
    if config_name is None:
        config_name = os.getenv('FLASK_ENV', 'development')
    
    config = get_config(config_name)
    app.config.from_object(config)
    
    # Setup logging
    setup_logging(app, config)

    # Initialize broadcaster
    broadcaster = FrameBroadcaster(
        redis_host=app.config['REDIS_HOST'],
        redis_port=app.config['REDIS_PORT'],
        channel=app.config['REDIS_CHANNEL']
    )

    # Store broadcaster in app context
    app.broadcaster = broadcaster
    
    # Register blueprints
    app.register_blueprint(routes.bp)

    # Add shutdown handler
    @app.teardown_appcontext
    def cleanup_broadcaster(error):
        if hasattr(app, 'broadcaster'):
            app.broadcaster.stop()
    
    app.logger.info(f"Stream Receiver initialized with config: {config_name}")

    return app


def main():
    """Main entry point for running the application."""
    app = create_app()
    
    app.run(
        host=app.config['HOST'],
        port=app.config['PORT'],
        debug=app.config['DEBUG'],
        threaded=True
    )


if __name__ == '__main__':
    main()
