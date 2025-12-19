import express from 'express';
import cameraRouter from './routes/camera.ts';

const app = express();

app.use(express.json());

// Serve client side files
app.use(express.static('public'));
// Register routes for camera selection
app.use('/camera', cameraRouter);

export default app;
