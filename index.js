const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const apiRouter = require('./router.js');
const db = require('./model');
const { notFoundHandler, errorHandler } = require('./util/errorHandler');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/v1', apiRouter);

app.get('/', (req, res) => {
  res.json({ message: 'Capstone backend is running' });
});

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
  try {
    await db.sequelize.authenticate();
    console.log('MySQL database connected successfully.');
    await db.sequelize.sync();
    console.log('Sequelize models synced successfully.');
    app.listen(port, () => {
      console.log(`App connected to port ${port}`);
    });
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
};

startServer();

