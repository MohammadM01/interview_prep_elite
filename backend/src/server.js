import app from './app.js';
import { config } from './config/index.js';

const server = app.listen(config.port, () => {
  console.log(`Backend server running on port ${config.port} in ${config.env} mode`);
  console.log(`Health check: http://localhost:${config.port}/api/health`);
});

export default server;
