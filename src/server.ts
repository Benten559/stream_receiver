import * as dotenv from 'dotenv';

dotenv.config();

import app from './app.ts';
import { initializeConfig } from './config/index.ts'
import { CameraService } from './services/camera_service.ts';
import cameraRouter  from './routes/camera.ts'

const config = initializeConfig();

// Dependency injection of camera functionality
export const cameraService = new CameraService();

(async () => {
     cameraService.initialize();

    app.use("/camera", cameraRouter);
    app.listen(config.server.port, () => {
        console.log(`Server listening on port ${config.server.port}`);
    });
})();
