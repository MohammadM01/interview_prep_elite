import app from './app.js';
import { config } from './config/index.js';
import { connectToDatabase } from './config/database.js';

async function startServer() {
  try {
    await connectToDatabase();

    const server = app.listen(config.port, () => {
      console.log(`Backend server running on port ${config.port} in ${config.env} mode`);
      console.log(`Health check: http://localhost:${config.port}/api/health`);
    });

    return server;
  } catch (error) {
    console.error('Failed to start server due to database connection error:', error.message);
    process.exit(1);
  }
}

const server = startServer();

export default server;
