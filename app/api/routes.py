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
    Efficient video feed endpoint.
    
    Returns:
        Response: Streaming HTTP response with video frames
    """
    logger.info("Video feed requested")
    
    try:
        # Check if we've hit viewer limit
        broadcaster = current_app.broadcaster
        current_viewers = len(broadcaster.viewers)
        max_viewers = current_app.config['MAX_VIEWERS']
        
        if current_viewers >= max_viewers:
            logger.warning(f"Viewer limit reached: {current_viewers}/{max_viewers}")
            return jsonify({
                'error': 'Too many viewers',
                'current_viewers': current_viewers,
                'max_viewers': max_viewers
            }), 429
        
        # Create new viewer
        viewer = broadcaster.add_viewer()
        
        # Return streaming response
        return Response(
            viewer.get_frame_generator(),
            mimetype='multipart/x-mixed-replace; boundary=frame',
            headers={
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        )
        
    except Exception as e:
        logger.error(f"Error in video_feed: {e}", exc_info=True)
        return jsonify({'error': 'Stream initialization failed'}), 500


@bp.route('/status')
def status():
    """
    Get current streaming status.
    
    Returns:
        JSON: Status information including viewer count, stats, etc.
    """
    try:
        broadcaster = current_app.broadcaster
        stats = broadcaster.get_stats()
        
        return jsonify({
            'status': 'healthy',
            'broadcaster': {
                'viewers': stats['viewers'],
                'frames_received': stats['frames_received'],
                'frames_broadcasted': stats['frames_broadcasted'],
                'fps': round(stats['fps'], 2),
                'runtime_seconds': round(stats['runtime_seconds'], 1),
                'memory_efficient': stats['memory_efficient']
            },
            'redis': {
                'connected': broadcaster.redis_client is not None,
                'host': current_app.config['REDIS_HOST'],
                'port': current_app.config['REDIS_PORT'],
                'channel': current_app.config['REDIS_CHANNEL']
            },
            'system': {
                'max_viewers': current_app.config['MAX_VIEWERS'],
                'frame_timeout': current_app.config['FRAME_TIMEOUT'],
                'current_frame_available': broadcaster.current_frame is not None
            },
            'timestamp': stats.get('timestamp', 0)
        })
        
    except Exception as e:
        logger.error(f"Error getting status: {e}", exc_info=True)
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@bp.route('/viewers')
def viewers():
    """
    Get detailed viewer information.
    
    Returns:
        JSON: Detailed viewer statistics
    """
    try:
        broadcaster = current_app.broadcaster
        
        with broadcaster.viewers_lock:
            viewer_details = []
            for viewer_id, viewer in broadcaster.viewers.items():
                viewer_details.append({
                    'id': viewer_id[:8],  # First 8 chars for privacy
                    'queue_size': viewer.frame_queue.qsize(),
                    'active': viewer.active,
                    'last_frame_timestamp': viewer.last_frame_timestamp
                })
        
        return jsonify({
            'viewer_count': len(viewer_details),
            'max_viewers': current_app.config['MAX_VIEWERS'],
            'viewers': viewer_details
        })
        
    except Exception as e:
        logger.error(f"Error getting viewer info: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@bp.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404


@bp.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    logger.error(f"Internal server error: {error}", exc_info=True)
    return jsonify({'error': 'Internal server error'}), 500