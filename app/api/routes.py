"""
Main application routes.
"""

from flask import Blueprint, Response, render_template, current_app, jsonify
import logging

bp = Blueprint('main', __name__)
logger = logging.getLogger(__name__)


@bp.route('/')
def index():
    """Main streaming page."""
    logger.info("Index page accessed")
    return render_template('index.html')


@bp.route('/video_feed')
def video_feed():
    """
    Simple JPEG frame endpoint
    Gives you just one frame from the camera

    """
    logger.info("Video feed requested")
    
    broadcaster = current_app.broadcaster
    frame_data, timestamp = broadcaster.get_current_frame()
    
    if not frame_data:
        return jsonify({'error': 'No frame available'}), 503
    
    return Response(
        frame_data,
        mimetype='image/jpeg',
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    )

@bp.route('/video_stream')
def video_stream():
    """
    End point creates new connection to Redis server and creates persistent stream of data.
    Expected format from Redis contains:
    payload :
        "type" : "message"
        "data" : <bunch o bytes>
    
    
    """
    logger.info("Direct Redis video stream requested")
    
    # Get config values in Flask context
    redis_host = current_app.config['REDIS_HOST']
    redis_port = current_app.config['REDIS_PORT']
    redis_channel = current_app.config['REDIS_CHANNEL']
    
    def generate():
        import time
        import redis
        import hashlib
        
        frame_count = 0
        last_hash = None
        
        while True:
            try:
                # Direct Redis connection for each stream
                redis_client = redis.Redis(
                    host=redis_host,
                    port=redis_port,
                    decode_responses=False
                )
                
                pubsub = redis_client.pubsub()
                pubsub.subscribe(redis_channel)
                logger.info(f"Stream connected to Redis {redis_channel}")
                
                # Listen for messages
                while True:
                    try:
                        message = pubsub.get_message(timeout=1.0)
                        
                        if message and message['type'] == 'message':
                            frame_data = message['data']
                            
                            # Validate frame
                            if isinstance(frame_data, bytes) and len(frame_data) > 100:
                                # Check if frame is different
                                current_hash = hashlib.md5(frame_data).hexdigest()[:8]
                                
                                if current_hash != last_hash:
                                    # Send multipart frame
                                    yield b'--frame\r\n'
                                    yield b'Content-Type: image/jpeg\r\n'
                                    yield f'Content-Length: {len(frame_data)}\r\n'.encode()
                                    yield b'\r\n'
                                    yield frame_data
                                    yield b'\r\n'
                                    
                                    frame_count += 1
                                    last_hash = current_hash
                                    
                                    if frame_count % 10 == 0:
                                        logger.info(f"Streamed {frame_count} live frames")
                    
                    except redis.ConnectionError:
                        logger.error("Redis connection lost, reconnecting...")
                        break
                    except Exception as e:
                        logger.error(f"Stream message error: {e}")
                        time.sleep(0.1)
                
                # Cleanup
                pubsub.unsubscribe()
                pubsub.close()
                redis_client.close()
                
            except GeneratorExit:
                logger.info(f"Video stream disconnected after {frame_count} frames")
                break
            except Exception as e:
                logger.error(f"Redis stream error: {e}")
                time.sleep(5)  # Wait before retry
    
    return Response(
        generate(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Connection': 'close'
        }
    )



@bp.route('/status')
def status():
    """
    Get current streaming status.
    """
    try:
        broadcaster = current_app.broadcaster
        stats = broadcaster.get_stats()
        
        return jsonify({
            'status': 'healthy',
            'frames_received': stats['frames_received'],
            'current_frame_available': stats['current_frame_available']
        })
        
    except Exception as e:
        logger.error(f"Error getting status: {e}", exc_info=True)
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500




@bp.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404


@bp.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    logger.error(f"Internal server error: {error}", exc_info=True)
    return jsonify({'error': 'Internal server error'}), 500